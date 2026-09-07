const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const userSchema = new Schema(
    {
      name: {type: String, required: true},
      phone: {type: String, required: true, unique: true},
      email: {type: String, unique: true, sparse: true, lowercase: true},
      password_hash: {type: String, required: true},
      push_token: {type: String},
      location: {type: String, default: ""},
      district: {type: String, default: ""},
    },
    {
      timestamps: true,
      collection: "users",
    },
);

const User = mongoose.model("User", userSchema);

module.exports = User;
