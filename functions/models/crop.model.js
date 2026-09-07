const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const cropSchema = new Schema(
    {
      user_id: {type: Schema.Types.ObjectId, ref: "User", required: true},
      farm_id: {type: Schema.Types.ObjectId, ref: "Unit", required: true},
      name: {type: String, required: true},
      type: {type: String, default: "crops"},
      category: {type: String},
      growth_cycle: {type: String},
      status: {type: String, default: "planted"},
      seeding_date: {type: Date},
      cultivation_date: {type: Date},
    },
    {
      timestamps: true,
      collection: "crops",
    },
);

const Crop = mongoose.model("Crop", cropSchema);

module.exports = Crop;
