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

const UNIT_TYPES = [
  "field", "crops", "pond",
  "livestock", "poultry",
];
const CROP_STATUSES = [
  "planted", "growing", "cultivated",
];
const MAX_LIVE_CROPS = 3;
const LIVE_CROP_LIMIT_MSG =
    "You can only have 3 live crops in a unit. " +
    "Mark a crop as Cultivated to free up space.";
const UNIT_TYPE_PATTERN =
    "^(field|crops|pond|livestock|poultry)$";
const CROP_STATUS_PATTERN =
    "^(planted|growing|cultivated)$";

/**
 * Creates a body field validation error.
 * @param {string} field - Field name.
 * @param {string} msg - Error message.
 * @param {string} type - Error type.
 * @return {Object} Error response object.
 */
function bodyError(field, msg, type) {
  return {
    detail: [
      {loc: ["body", field], msg: msg, type: type},
    ],
  };
}

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
 * Formats a crop document for API responses.
 * @param {Object} c - Mongoose crop document.
 * @return {Object} Formatted crop object.
 */
function cropResponse(c) {
  return {
    id: c._id.toString(),
    farm_id: c.farm_id.toString(),
    name: c.name,
    type: c.type,
    category: c.category || null,
    growth_cycle: c.growth_cycle || null,
    status: c.status,
    seeding_date: formatDate(c.seeding_date),
    cultivation_date: formatDate(
        c.cultivation_date,
    ),
    created_at: c.createdAt.toISOString(),
  };
}

/**
 * Formats a unit document for API responses.
 * @param {Object} u - Mongoose unit document.
 * @param {Array} crops - Array of crop documents.
 * @return {Object} Formatted unit object.
 */
function unitResponse(u, crops) {
  return {
    id: u._id.toString(),
    name: u.name,
    type: u.type,
    location: u.location,
    area_acres: u.area_acres,
    live_crops_details:
      u.live_crops_details || null,
    crops: crops.map(cropResponse),
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

/**
 * Validates a unit creation/update payload.
 * @param {Object} body - Request body.
 * @param {boolean} partial - True for PATCH.
 * @return {Object|null} Error or null.
 */
function validateUnitPayload(body, partial) {
  if (
    !partial &&
    typeof body.name !== "string"
  ) {
    return bodyError(
        "name",
        "Field required",
        "value_error.missing",
    );
  }
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" ||
    body.name.trim().length === 0 ||
    body.name.trim().length > 255)
  ) {
    return bodyError(
        "name",
        "String should have " +
          "at most 255 characters",
        "string_too_long",
    );
  }
  if (body.type !== undefined) {
    if (
      typeof body.type !== "string" ||
      !UNIT_TYPES.includes(body.type)
    ) {
      return bodyError(
          "type",
          "String should match pattern " +
            `'${UNIT_TYPE_PATTERN}'`,
          "string_pattern_mismatch",
      );
    }
  }
  if (
    body.location !== undefined &&
    (typeof body.location !== "string" ||
    body.location.length > 255)
  ) {
    return bodyError(
        "location",
        "String should have " +
          "at most 255 characters",
        "string_too_long",
    );
  }
  if (body.area_acres !== undefined) {
    if (
      typeof body.area_acres !== "number" ||
      body.area_acres < 0
    ) {
      return bodyError(
          "area_acres",
          "Input should be greater " +
            "than or equal to 0",
          "greater_than_equal",
      );
    }
  }
  return null;
}

/**
 * Validates a crop creation/update payload.
 * @param {Object} body - Request body.
 * @param {boolean} partial - True for PATCH.
 * @return {Object|null} Error or null.
 */
function validateCropPayload(body, partial) {
  if (
    !partial &&
    typeof body.name !== "string"
  ) {
    return bodyError(
        "name",
        "Field required",
        "value_error.missing",
    );
  }
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" ||
    body.name.trim().length === 0 ||
    body.name.trim().length > 255)
  ) {
    return bodyError(
        "name",
        "String should have " +
          "at most 255 characters",
        "string_too_long",
    );
  }
  if (body.type !== undefined) {
    if (
      typeof body.type !== "string" ||
      !UNIT_TYPES.includes(body.type)
    ) {
      return bodyError(
          "type",
          "String should match pattern " +
            `'${UNIT_TYPE_PATTERN}'`,
          "string_pattern_mismatch",
      );
    }
  }
  if (
    body.category !== undefined &&
    (typeof body.category !== "string" ||
    body.category.length > 40)
  ) {
    return bodyError(
        "category",
        "String should have " +
          "at most 40 characters",
        "string_too_long",
    );
  }
  if (
    body.growth_cycle !== undefined &&
    (typeof body.growth_cycle !== "string" ||
    body.growth_cycle.length > 20)
  ) {
    return bodyError(
        "growth_cycle",
        "String should have " +
          "at most 20 characters",
        "string_too_long",
    );
  }
  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !CROP_STATUSES.includes(body.status)
    ) {
      return bodyError(
          "status",
          "String should match pattern " +
            `'${CROP_STATUS_PATTERN}'`,
          "string_pattern_mismatch",
      );
    }
  }
  if (
    body.seeding_date !== undefined &&
    body.seeding_date !== null &&
    typeof body.seeding_date !== "string"
  ) {
    return bodyError(
        "seeding_date",
        "Input should be a valid date",
        "date_type",
    );
  }
  if (
    body.cultivation_date !== undefined &&
    body.cultivation_date !== null &&
    typeof body.cultivation_date !== "string"
  ) {
    return bodyError(
        "cultivation_date",
        "Input should be a valid date",
        "date_type",
    );
  }
  return null;
}

/**
 * Validates a MongoDB ObjectId string.
 * @param {string} id - The ID to validate.
 * @return {boolean} True if valid ObjectId.
 */
function isValidObjectId(id) {
  return mongoose.isValidObjectId(id);
}

router.route("/").get(
    requireAuth,
    async (req, res) => {
      try {
        const units = await Unit.find({
          user_id: req.user._id,
        }).sort({created_at: -1});
        const unitIds = units.map((u) => u._id);
        const crops = await Crop.find({
          user_id: req.user._id,
          farm_id: {$in: unitIds},
        });
        const cropsByUnit = {};
        crops.forEach((c) => {
          const key =
            c.farm_id.toString();
          if (!cropsByUnit[key]) {
            cropsByUnit[key] = [];
          }
          cropsByUnit[key].push(c);
        });
        res.json(
            units.map((u) =>
              unitResponse(
                  u,
                  cropsByUnit[
                      u._id.toString()
                  ] || [],
              ),
            ),
        );
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route("/").post(
    requireAuth,
    async (req, res) => {
      const error = validateUnitPayload(
          req.body,
          false,
      );
      if (error) {
        return res.status(422).json(error);
      }
      const unit = new Unit({
        user_id: req.user._id,
        name: req.body.name.trim(),
        type: req.body.type || "crops",
        location:
          (req.body.location || "").trim(),
        area_acres: req.body.area_acres || 0,
      });
      try {
        await unit.save();
        res
            .status(201)
            .json(unitResponse(unit, []));
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route("/:unit_id").patch(
    requireAuth,
    async (req, res) => {
      if (
        !isValidObjectId(
            req.params.unit_id,
        )
      ) {
        return res.status(404).json({
          detail: "Unit not found",
        });
      }
      const error = validateUnitPayload(
          req.body,
          true,
      );
      if (error) {
        return res.status(422).json(error);
      }
      try {
        const unit = await Unit.findOne({
          _id: req.params.unit_id,
          user_id: req.user._id,
        });
        if (!unit) {
          return res.status(404).json({
            detail: "Unit not found",
          });
        }
        if (
          req.body.name !== undefined
        ) {
          unit.name =
            req.body.name.trim();
        }
        if (
          req.body.type !== undefined
        ) {
          unit.type = req.body.type;
        }
        if (
          req.body.location !== undefined
        ) {
          unit.location =
            req.body.location.trim();
        }
        if (
          req.body.area_acres !== undefined
        ) {
          unit.area_acres =
            req.body.area_acres;
        }
        await unit.save();
        const crops = await Crop.find({
          farm_id: unit._id,
          user_id: req.user._id,
        });
        res.json(
            unitResponse(unit, crops),
        );
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route("/:unit_id").delete(
    requireAuth,
    async (req, res) => {
      if (
        !isValidObjectId(
            req.params.unit_id,
        )
      ) {
        return res.status(404).json({
          detail: "Unit not found",
        });
      }
      try {
        const unit = await Unit.findOne({
          _id: req.params.unit_id,
          user_id: req.user._id,
        });
        if (!unit) {
          return res.status(404).json({
            detail: "Unit not found",
          });
        }
        await Crop.deleteMany({
          farm_id: unit._id,
          user_id: req.user._id,
        });
        await FarmBudget.deleteMany({
          farm_id: unit._id,
          user_id: req.user._id,
        });
        await LedgerEntry.deleteMany({
          farm_id: unit._id,
          user_id: req.user._id,
        });
        await unit.deleteOne();
        res.status(204).end();
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route("/:unit_id/crops").post(
    requireAuth,
    async (req, res) => {
      if (
        !isValidObjectId(
            req.params.unit_id,
        )
      ) {
        return res.status(404).json({
          detail: "Unit not found",
        });
      }
      const error = validateCropPayload(
          req.body,
          false,
      );
      if (error) {
        return res.status(422).json(error);
      }
      try {
        const unit = await Unit.findOne({
          _id: req.params.unit_id,
          user_id: req.user._id,
        });
        if (!unit) {
          return res.status(404).json({
            detail: "Unit not found",
          });
        }
        const liveCount =
          await Crop.countDocuments({
            farm_id: unit._id,
            user_id: req.user._id,
            status: {$ne: "cultivated"},
          });
        if (liveCount >= MAX_LIVE_CROPS) {
          return res.status(400).json({
            detail: LIVE_CROP_LIMIT_MSG,
          });
        }
        const crop = new Crop({
          user_id: req.user._id,
          farm_id: unit._id,
          name: req.body.name.trim(),
          type: req.body.type || "crops",
          category:
            req.body.category || null,
          growth_cycle:
            req.body.growth_cycle || null,
          status:
            req.body.status || "planted",
          seeding_date:
            req.body.seeding_date ?
              new Date(
                  req.body.seeding_date,
              ) :
              null,
          cultivation_date:
            req.body.cultivation_date ?
              new Date(
                  req.body.cultivation_date,
              ) :
              null,
        });
        await crop.save();
        res
            .status(201)
            .json(cropResponse(crop));
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route(
    "/:unit_id/crops/:crop_id",
).patch(
    requireAuth,
    async (req, res) => {
      if (
        !isValidObjectId(
            req.params.unit_id,
        ) ||
        !isValidObjectId(
            req.params.crop_id,
        )
      ) {
        return res.status(404).json({
          detail: "Crop not found",
        });
      }
      const error = validateCropPayload(
          req.body,
          true,
      );
      if (error) {
        return res.status(422).json(error);
      }
      try {
        const crop = await Crop.findOne({
          _id: req.params.crop_id,
          farm_id: req.params.unit_id,
          user_id: req.user._id,
        });
        if (!crop) {
          return res.status(404).json({
            detail: "Crop not found",
          });
        }
        if (
          req.body.name !== undefined
        ) {
          crop.name =
            req.body.name.trim();
        }
        if (
          req.body.type !== undefined
        ) {
          crop.type = req.body.type;
        }
        if (
          req.body.category !== undefined
        ) {
          crop.category =
            req.body.category;
        }
        if (
          req.body.growth_cycle !==
            undefined
        ) {
          crop.growth_cycle =
            req.body.growth_cycle;
        }
        if (
          req.body.status !== undefined
        ) {
          crop.status = req.body.status;
        }
        if (
          req.body.seeding_date !==
            undefined
        ) {
          crop.seeding_date =
            req.body.seeding_date ?
              new Date(
                  req.body.seeding_date,
              ) :
              null;
        }
        if (
          req.body.cultivation_date !==
            undefined
        ) {
          crop.cultivation_date =
            req.body.cultivation_date ?
              new Date(
                  req.body.cultivation_date,
              ) :
              null;
        }
        await crop.save();
        res.json(cropResponse(crop));
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route(
    "/:unit_id/crops/:crop_id",
).delete(
    requireAuth,
    async (req, res) => {
      if (
        !isValidObjectId(
            req.params.unit_id,
        ) ||
        !isValidObjectId(
            req.params.crop_id,
        )
      ) {
        return res.status(404).json({
          detail: "Crop not found",
        });
      }
      try {
        const crop = await Crop.findOne({
          _id: req.params.crop_id,
          farm_id: req.params.unit_id,
          user_id: req.user._id,
        });
        if (!crop) {
          return res.status(404).json({
            detail: "Crop not found",
          });
        }
        await crop.deleteOne();
        res.status(204).end();
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

module.exports = router;
