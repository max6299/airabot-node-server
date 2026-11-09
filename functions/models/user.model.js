const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const userSchema = new Schema(
    {
      name: {type: String, required: true},
      phone: {type: String, required: true, unique: true},
      email: {type: String, unique: true, sparse: true, lowercase: true},
      password_hash: {type: String, required: true},
      otp_verified: {type: Boolean, default: false},
      otp_val: {type: String},
      otp_expires_at: {type: Date},
      push_token: {type: String},
      location: {type: String, default: ""},
      district: {type: String, default: ""},
      gender: {
        type: String,
        enum: ["male", "female", "other", ""],
        default: "",
      },
      dob: {type: String, default: ""},
      marital_status: {
        type: String,
        enum: ["single", "married", ""],
        default: "",
      },
      profession: {type: String, default: ""},
    },
    {
      timestamps: true,
      collection: "users",
    },
);

const User = mongoose.model("User", userSchema);

module.exports = User;
