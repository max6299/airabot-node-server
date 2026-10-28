const expmod = require("express");
const mongoose = require("mongoose");
const Unit = require("../models/unit.model");
const Crop = require("../models/crop.model");
const FarmBudget =
    require("../models/farmbudget.model");
const LedgerEntry =
    require("../models/ledgerentry.model");
const {requireAuth} = require("../middleware/auth");

const router = new expmod.Router();

/**
 * Formats a date to ISO date string.
 * @param {Date} d - Date object.
 * @return {string|null} Formatted date or null.
 */
function formatDate(d) {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Formats a budget document for API responses.
 * @param {Object} b - Mongoose budget document.
 * @return {Object} Formatted budget object.
 */
function budgetResponse(b) {
  return {
    id: b._id.toString(),
    farm_id: b.farm_id.toString(),
    estimated_expense: b.estimated_expense,
    updated_at: b.updatedAt.toISOString(),
  };
}

/**
 * Formats a ledger entry for API responses.
 * @param {Object} e - Mongoose ledger entry document.
 * @return {Object} Formatted ledger entry object.
 */
function ledgerResponse(e) {
  return {
    id: e._id.toString(),
    farm_id: e.farm_id.toString(),
    crop_id:
      e.crop_id ?
        e.crop_id.toString() :
        null,
    type: e.type,
    category: e.category,
    amount: e.amount,
    note: e.note || null,
    entry_date: formatDate(e.entry_date),
    created_at: e.createdAt.toISOString(),
  };
}

/**
 * Validates a MongoDB ObjectId string.
 * @param {string} id - The ID to validate.
 * @return {boolean} True if valid ObjectId.
 */
function isValidObjectId(id) {
  return mongoose.isValidObjectId(id);
}

router.route("/summary").get(
    requireAuth,
    async (req, res) => {
      try {
        const units = await Unit.find({
          user_id: req.user._id,
        }).sort({created_at: -1});
        const unitIds = units.map((u) => u._id);
        const [budgets, entries] =
          await Promise.all([
            FarmBudget.find({
              user_id: req.user._id,
              farm_id: {$in: unitIds},
            }),
            LedgerEntry.find({
              user_id: req.user._id,
              farm_id: {$in: unitIds},
            }),
          ]);
        const budgetByFarm = {};
        budgets.forEach((b) => {
          budgetByFarm[b.farm_id.toString()] = b;
        });
        const entriesByFarm = {};
        entries.forEach((e) => {
          const key = e.farm_id.toString();
          if (!entriesByFarm[key]) {
            entriesByFarm[key] = [];
          }
          entriesByFarm[key].push(e);
        });

        let totalEstimated = 0;
        let totalSpent = 0;
        let totalIncome = 0;
        const farmRows = units.map((farm) => {
          const farmEntries =
            entriesByFarm[
                farm._id.toString()
            ] || [];
          let spent = 0;
          let income = 0;
          farmEntries.forEach((e) => {
            if (e.type === "debit") {
              spent += e.amount;
            }
            if (e.type === "credit") {
              income += e.amount;
            }
          });
          const budget =
            budgetByFarm[
                farm._id.toString()
            ];
          const estimated =
            budget ?
              budget.estimated_expense :
              0;
          totalEstimated += estimated;
          totalSpent += spent;
          totalIncome += income;
          return {
            farm_id: farm._id.toString(),
            farm_name: farm.name,
            estimated: estimated,
            spent: spent,
            remaining: estimated - spent,
          };
        });

        res.json({ success: true,
          message: "Finance Summary",
          total_estimated: totalEstimated,
          total_spent: totalSpent,
          total_remaining:
            totalEstimated - totalSpent,
          total_income: totalIncome,
          profit_loss: totalIncome - totalSpent,
          farms: farmRows,
        });
      } catch (err) {
        res.status(500).json({ success: false,
          detail: "Internal server error",
        });
      }
    },
);

router.route("/budgets/update").post(
    requireAuth,
    async (req, res) => {
      const farmId = req.body.farm_id;
      if (!isValidObjectId(farmId)) {
        return res.status(404).json({ success: false,
          detail: "Unit not found",
        });
      }
      const estimatedExpense =
        req.body.estimated_expense;
      try {
        const farm = await Unit.findOne({
          _id: farmId,
          user_id: req.user._id,
        });
        if (!farm) {
          return res.status(404).json({ success: false,
            detail: "Unit not found",
          });
        }
        let budget = await FarmBudget.findOne({
          farm_id: farm._id,
          user_id: req.user._id,
        });
        if (!budget) {
          budget = new FarmBudget({
            user_id: req.user._id,
            farm_id: farm._id,
            estimated_expense: estimatedExpense,
          });
        } else {
          budget.estimated_expense =
            estimatedExpense;
        }
        await budget.save();
        res.json({ success: true, message: "Budget Updated", ...budgetResponse(budget) });
      } catch (err) {
        res.status(500).json({ success: false,
          detail: "Internal server error",
        });
      }
    },
);

router.route("/ledger").get(
    requireAuth,
    async (req, res) => {
      const filter = {user_id: req.user._id};
      if (req.query.farm_id !== undefined) {
        if (!isValidObjectId(req.query.farm_id)) {
          return res.status(404).json({ success: false,
            detail: "Ledger entry not found",
          });
        }
        filter.farm_id = req.query.farm_id;
      }
      if (req.query.crop_id !== undefined) {
        if (!isValidObjectId(req.query.crop_id)) {
          return res.status(404).json({ success: false,
            detail: "Ledger entry not found",
          });
        }
        filter.crop_id = req.query.crop_id;
      }
      try {
        const entries = await LedgerEntry.find(
            filter,
        ).sort({
          entry_date: -1,
          created_at: -1,
        });
        res.json({
          success: true,
          message: "Ledger List",
          data: entries.map(ledgerResponse),
        });
      } catch (err) {
        res.status(500).json({ success: false,
          detail: "Internal server error",
        });
      }
    },
);

router.route("/ledger").post(
    requireAuth,
    async (req, res) => {
      const farmId = req.body.farm_id;
      const cropId = req.body.crop_id;
      const type = req.body.type;
      const category = req.body.category;
      const amount = req.body.amount;
      const note = req.body.note;
      const entryDate = req.body.entry_date;

      try {
        const farm = await Unit.findOne({
          _id: farmId,
          user_id: req.user._id,
        });
        if (!farm) {
          return res.status(404).json({ success: false,
            detail: "Unit not found",
          });
        }
        if (cropId) {
          const crop = await Crop.findOne({
            _id: cropId,
            user_id: req.user._id,
            farm_id: farm._id,
          });
          if (!crop) {
            return res.status(400).json({ success: false,
              detail:
                "Crop not found for this unit",
            });
          }
        }
        const entry = new LedgerEntry({
          user_id: req.user._id,
          farm_id: farm._id,
          crop_id: cropId || null,
          type: type,
          category: typeof category === "string" ? category.trim() : "",
          amount: amount,
          note:
            note !== undefined && note !== null ?
              (typeof note === "string" ? note.trim() : null) :
              null,
          entry_date: new Date(entryDate),
        });
        await entry.save();
        res
            .status(201)
            .json({ success: true, message: "Ledger Entry Created", ...ledgerResponse(entry) });
      } catch (err) {
        res.status(500).json({ success: false,
          detail: "Internal server error",
        });
      }
    },
);

router.route("/ledger/update").post(
    requireAuth,
    async (req, res) => {
      const entryId = req.body.entry_id;
      if (
        !isValidObjectId(entryId)
      ) {
        return res.status(404).json({ success: false,
          detail: "Ledger entry not found",
        });
      }
      try {
        const entry =
          await LedgerEntry.findOne({
            _id: entryId,
            user_id: req.user._id,
          });
        if (!entry) {
          return res.status(404).json({ success: false,
            detail: "Ledger entry not found",
          });
        }
        if (req.body.farm_id !== undefined) {
          if (
            !isValidObjectId(req.body.farm_id)
          ) {
            return res.status(404).json({ success: false,
              detail: "Unit not found",
            });
          }
          const farm = await Unit.findOne({
            _id: req.body.farm_id,
            user_id: req.user._id,
          });
          if (!farm) {
            return res.status(404).json({ success: false,
              detail: "Unit not found",
            });
          }
          entry.farm_id = farm._id;
        }
        if (req.body.crop_id !== undefined) {
          if (req.body.crop_id === null) {
            entry.crop_id = null;
          } else {
            if (
              !isValidObjectId(
                  req.body.crop_id,
              )
            ) {
              return res.status(400).json({ success: false,
                detail:
                  "Crop not found for " +
                    "this unit",
              });
            }
            const farmId =
              req.body.farm_id ||
              entry.farm_id;
            const crop =
              await Crop.findOne({
                _id: req.body.crop_id,
                user_id: req.user._id,
                farm_id: farmId,
              });
            if (!crop) {
              return res.status(400).json({ success: false,
                detail:
                  "Crop not found " +
                    "for this unit",
              });
            }
            entry.crop_id = crop._id;
          }
        }
        if (req.body.type !== undefined) {
          entry.type = req.body.type;
        }
        if (
          req.body.category !== undefined
        ) {
          entry.category =
            typeof req.body.category === "string" ?
              req.body.category.trim() :
              req.body.category;
        }
        if (req.body.amount !== undefined) {
          entry.amount = req.body.amount;
        }
        if (req.body.note !== undefined) {
          entry.note =
            req.body.note === null ?
              null :
              (typeof req.body.note === "string" ?
                req.body.note.trim() :
                req.body.note);
        }
        if (
          req.body.entry_date !== undefined
        ) {
          entry.entry_date = new Date(
              req.body.entry_date,
          );
        }
        await entry.save();
        res.json({ success: true, message: "Ledger Entry Updated", ...ledgerResponse(entry) });
      } catch (err) {
        res.status(500).json({ success: false,
          detail: "Internal server error",
        });
      }
    },
);

router.route("/ledger/delete").post(
    requireAuth,
    async (req, res) => {
      const entryId = req.body.entry_id;
      if (
        !isValidObjectId(entryId)
      ) {
        return res.status(404).json({ success: false,
          detail: "Ledger entry not found",
        });
      }
      try {
        const entry =
          await LedgerEntry.findOne({
            _id: entryId,
            user_id: req.user._id,
          });
        if (!entry) {
          return res.status(404).json({ success: false,
            detail: "Ledger entry not found",
          });
        }
        await entry.deleteOne();
        res.status(204).end();
      } catch (err) {
        res.status(500).json({ success: false,
          detail: "Internal server error",
        });
      }
    },
);

module.exports = router;
