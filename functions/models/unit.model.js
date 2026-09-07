const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const unitSchema = new Schema(
    {
      user_id: {type: Schema.Types.ObjectId, ref: "User", required: true},
      name: {type: String, required: true},
      type: {type: String, default: "crops"},
      location: {type: String, default: ""},
      area_acres: {type: Number, default: 0},
      live_crops_details: {type: String},
    },
    {
      timestamps: true,
      collection: "units",
    },
);

const Unit = mongoose.model("Unit", unitSchema);

module.exports = Unit;
