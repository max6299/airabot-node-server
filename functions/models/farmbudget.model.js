const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const farmBudgetSchema = new Schema(
    {
      user_id: {type: Schema.Types.ObjectId, ref: "User", required: true},
      farm_id: {type: Schema.Types.ObjectId, ref: "Unit", required: true},
      estimated_expense: {type: Number, default: 0},
    },
    {
      timestamps: true,
      collection: "farm_budgets",
    },
);

farmBudgetSchema.index({user_id: 1, farm_id: 1}, {unique: true});

const FarmBudget = mongoose.model("FarmBudget", farmBudgetSchema);

module.exports = FarmBudget;
