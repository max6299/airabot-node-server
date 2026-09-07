const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const ledgerEntrySchema = new Schema(
    {
      user_id: {type: Schema.Types.ObjectId, ref: "User", required: true},
      farm_id: {type: Schema.Types.ObjectId, ref: "Unit", required: true},
      crop_id: {type: Schema.Types.ObjectId, ref: "Crop"},
      type: {type: String, default: "debit"},
      category: {type: String, default: "other"},
      amount: {type: Number, default: 0},
      note: {type: String},
      entry_date: {type: Date, required: true},
    },
    {
      timestamps: true,
      collection: "ledger_entries",
    },
);

const LedgerEntry = mongoose.model("LedgerEntry", ledgerEntrySchema);

module.exports = LedgerEntry;
