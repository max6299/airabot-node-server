const expmod = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const axios = require("axios");
const User = require("../models/user.model");
const {requireAuth} = require("../middleware/auth");

const router = new expmod.Router();

/**
 * Formats a user document for API responses.
 * @param {Object} user - Mongoose user document.
 * @return {Object} Formatted user object.
 */
function userResponse(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    phone: user.phone,
    email: user.email || null,
    otp_verified: user.otp_verified,
    location: user.location,
    district: user.district,
    gender: user.gender || "",
    dob: user.dob || "",
    marital_status: user.marital_status || "",
    profession: user.profession || "",
    created_at: user.createdAt.toISOString(),
  };
}

/**
 * Builds the full token response for a user.
 * @param {Object} user - Mongoose user document.
 * @return {Object} Token response object.
 */
function tokenResponse(user) {
  const userId = user._id.toString();
  const accessToken = jwt.sign(
      {
        sub: userId,
        type: "access",
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.SECRET_KEY,
      {
        expiresIn:
          process.env.ACCESS_TOKEN_EXPIRE_MINUTES + "m",
      },
  );
  const refreshToken = jwt.sign(
      {
        sub: userId,
        type: "refresh",
        tokenType: "RefToken",
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.REF_TOKEN_SECRET,
      {
        expiresIn:
          process.env.REFRESH_TOKEN_EXPIRE_DAYS + "d",
      },
  );
  return {
    access_token: accessToken,
    accessToken: accessToken,
    refresh_token: refreshToken,
    refreshToken: refreshToken,
    token_type: "bearer",
    expires_in:
      parseInt(
          process.env.ACCESS_TOKEN_EXPIRE_MINUTES,
          10,
      ) * 60,
  };
}

router.route("/register").post(async (req, res) => {
  const name = req.body.name;
  const phone = req.body.phone;
  const email = req.body.email;
  const password = req.body.password;

  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const cleanEmail =
    email && typeof email === "string" && email.trim() ?
      email.trim().toLowerCase() :
      null;
  try {
    const existingPhone = await User.findOne({
      phone: cleanPhone,
    });
    if (existingPhone) {
      return res.status(409).json({success: false,
        detail: "Phone number already registered",
      });
    }
    if (cleanEmail) {
      const existingEmail = await User.findOne({
        email: cleanEmail,
      });
      if (existingEmail) {
        return res.status(409).json({success: false,
          detail: "Email already registered",
        });
      }
    }
    const userData = {
      name: typeof name === "string" ? name.trim() : "",
      phone: cleanPhone,
      email: cleanEmail,
      password_hash: bcrypt.hashSync(password, 10),
    };
    const user = new User(userData);
    await user.save();
    res.status(201).json({success: true,
      message: "User Registered",
      ...tokenResponse(user),
      user: userResponse(user),
    });
  } catch (err) {
    res.status(500).json({success: false,
      detail: "Internal server error",
    });
  }
});

router.route("/login").post(async (req, res) => {
  const email = req.body.email;
  const phone = req.body.phone;
  const password = req.body.password;

  try {
    let user = null;
    if (phone && typeof phone === "string" && phone.trim()) {
      user = await User.findOne({phone: phone.trim()});
    } else if (email && typeof email === "string" && email.trim()) {
      user = await User.findOne({
        email: email.trim().toLowerCase(),
      });
    }
    if (
      !user ||
      !bcrypt.compareSync(
          password,
          user.password_hash,
      )
    ) {
      return res
          .status(401)
          .json({
            success: false,
            detail: "Invalid credentials",
          });
    }
    res.json({success: true,
      message: "Login Successful",
      ...tokenResponse(user),
      user: userResponse(user),
    });
  } catch (err) {
    res.status(500).json({success: false,
      detail: "Internal server error",
    });
  }
});

router.route("/refresh").post(async (req, res) => {
  const refreshToken = req.body.refresh_token;
  try {
    const decoded = jwt.verify(
        refreshToken,
        process.env.REF_TOKEN_SECRET,
    );
    if (decoded.type !== "refresh") {
      return res
          .status(401)
          .json({
            success: false,
            detail: "Invalid refresh token",
          });
    }
    const user = await User.findById(decoded.sub);
    if (!user) {
      return res
          .status(401)
          .json({
            success: false,
            detail: "Invalid refresh token",
          });
    }
    res.json({
      success: true,
      message: "Token Refreshed",
      ...tokenResponse(user),
    });
  } catch (err) {
    return res
        .status(401)
        .json({success: false, detail: "Invalid refresh token"});
  }
});

router.route("/me").get(requireAuth, (req, res) => {
  res.json({success: true, message: "User Profile", ...userResponse(req.user)});
});

router.route("/update").post(
    requireAuth,
    async (req, res) => {
      const {location, district, push_token: pushToken} = req.body;

      req.user.location = location;
      req.user.district = district;
      req.user.push_token = pushToken;

      try {
        await req.user.save();
        res.json({
          success: true,
          message: "User Profile",
          ...userResponse(req.user),
        });
      } catch (err) {
        res.status(500).json({success: false,
          detail: "Internal server error",
        });
      }
    },
);

router.route("/sendotp").post(async (req, res) => {
  const {phone} = req.body;
  const cleanPhone =
    typeof phone === "string" ? phone.trim() : "";

  if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({success: false,
      detail: "Enter a valid 10-digit Indian mobile number",
    });
  }

  try {
    const user = await User.findOne({phone: cleanPhone});
    if (!user) {
      return res.status(404).json({success: false,
        detail: "No account found with this mobile number",
      });
    }

    const otp = String(
        Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
    );

    user.otp_val = otp;
    user.otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const smsRes = await axios.get(
        "https://sms.hitechsms.com/app/smsapi/index.php",
        {
          params: {
            key: "569ABB2E778B41",
            campaign: 0,
            contacts: cleanPhone,
            msg: "Your OTP is " + otp +
              ". This code is valid for 10 minutes. " +
              "Do not share it with anyone. - TWORINGS",
            senderid: "TWRING",
            routeid: 13,
            type: "text",
            template_id: "1207177106220884239",
          },
        },
    );

    res.json({success: true,
      message: "OTP sent successfully",
      smsResponse: smsRes.data,
    });
  } catch (err) {
    console.error("[sendotp] Error:", err.message);
    res.status(500).json({success: false,
      detail: "Failed to send OTP. Please try again.",
    });
  }
});

router.route("/verifyotp").post(async (req, res) => {
  const {phone, otp} = req.body;
  const cleanPhone =
    typeof phone === "string" ? phone.trim() : "";
  const cleanOtp =
    typeof otp === "string" ? otp.trim() : "";

  if (!cleanPhone || !cleanOtp) {
    return res.status(400).json({success: false,
      detail: "Phone and OTP are required",
    });
  }

  try {
    const user = await User.findOne({phone: cleanPhone});
    if (!user) {
      return res.status(404).json({success: false,
        detail: "No account found with this mobile number",
      });
    }

    if (!user.otp_val) {
      return res.status(400).json({success: false,
        detail: "No OTP found. Please request a new one.",
      });
    }

    if (user.otp_expires_at < new Date()) {
      return res.status(400).json({success: false,
        detail: "OTP has expired. Please request a new one.",
      });
    }

    if (user.otp_val !== cleanOtp) {
      return res.status(400).json({success: false,
        detail: "Invalid OTP. Please try again.",
      });
    }

    user.otp_verified = true;
    user.otp_val = undefined;
    user.otp_expires_at = undefined;
    await user.save();

    res.json({success: true,
      message: "OTP verified successfully",
    });
  } catch (err) {
    console.error("[verifyotp] Error:", err.message);
    res.status(500).json({success: false,
      detail: "Failed to verify OTP. Please try again.",
    });
  }
});

router.route("/profile").put(
    requireAuth,
    async (req, res) => {
      const {
        gender,
        dob,
        marital_status: maritalStatus,
        profession,
        location,
        district,
      } = req.body;

      if (gender !== undefined) req.user.gender = gender;
      if (dob !== undefined) req.user.dob = dob;
      if (maritalStatus !== undefined) {
        req.user.marital_status = maritalStatus;
      }
      if (profession !== undefined) req.user.profession = profession;
      if (location !== undefined) req.user.location = location;
      if (district !== undefined) req.user.district = district;

      try {
        await req.user.save();
        res.json({
          success: true,
          message: "User Profile",
          ...userResponse(req.user),
        });
      } catch (err) {
        res.status(500).json({success: false, detail: "Internal server error"});
      }
    },
);

router.route("/change-phone").post(
    requireAuth,
    async (req, res) => {
      const {old_otp: oldOtp, new_phone: newPhone} = req.body;
      const cleanOldOtp = typeof oldOtp === "string" ? oldOtp.trim() : "";
      const cleanNewPhone = typeof newPhone === "string" ? newPhone.trim() : "";

      if (!cleanOldOtp) {
        return res.status(400).json({
          success: false,
          detail: "Old phone OTP is required",
        });
      }
      if (!cleanNewPhone || !/^[6-9]\d{9}$/.test(cleanNewPhone)) {
        return res.status(400).json({success: false,
          detail: "Enter a valid 10-digit Indian mobile number for new phone",
        });
      }

      try {
        if (!req.user.otp_val) {
          return res.status(400).json({
            success: false,
            detail: "No OTP found. Please request a new one.",
          });
        }
        if (req.user.otp_expires_at < new Date()) {
          return res.status(400).json({
            success: false,
            detail: "OTP has expired. Please request a new one.",
          });
        }
        if (req.user.otp_val !== cleanOldOtp) {
          return res.status(400).json({
            success: false,
            detail: "Invalid OTP. Please try again.",
          });
        }

        const existingPhone = await User.findOne({phone: cleanNewPhone});
        if (existingPhone) {
          return res.status(409).json({
            success: false,
            detail: "This phone number is already registered",
          });
        }

        const newOtp = String(
            Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
        );

        req.user.otp_val = newOtp;
        req.user.otp_expires_at = new Date(Date.now() + 10 * 60 * 1000);
        await req.user.save();

        try {
          await axios.get("https://sms.hitechsms.com/app/smsapi/index.php", {
            params: {
              key: "569ABB2E778B41",
              campaign: 0,
              contacts: cleanNewPhone,
              msg: "Your OTP is " + newOtp +
                ". This code is valid for 10 minutes. " +
                "Do not share it with anyone. - TWORINGS",
              senderid: "TWRING",
              routeid: 13,
              type: "text",
              template_id: "1207177106220884239",
            },
          });
        } catch (smsErr) {
          console.error("[change-phone] SMS failed:", smsErr.message);
        }

        res.json({success: true, message: "OTP sent to new phone number"});
      } catch (err) {
        res.status(500).json({success: false, detail: "Internal server error"});
      }
    },
);

router.route("/verify-new-phone").post(
    requireAuth,
    async (req, res) => {
      const {new_phone: newPhone, otp} = req.body;
      const cleanNewPhone = typeof newPhone === "string" ? newPhone.trim() : "";
      const cleanOtp = typeof otp === "string" ? otp.trim() : "";

      if (!cleanNewPhone || !cleanOtp) {
        return res.status(400).json({
          success: false,
          detail: "New phone and OTP are required",
        });
      }

      try {
        if (!req.user.otp_val) {
          return res.status(400).json({
            success: false,
            detail: "No OTP found. Please request a new one.",
          });
        }
        if (req.user.otp_expires_at < new Date()) {
          return res.status(400).json({
            success: false,
            detail: "OTP has expired. Please request a new one.",
          });
        }
        if (req.user.otp_val !== cleanOtp) {
          return res.status(400).json({
            success: false,
            detail: "Invalid OTP. Please try again.",
          });
        }

        const existingPhone = await User.findOne({phone: cleanNewPhone});
        if (existingPhone) {
          return res.status(409).json({
            success: false,
            detail: "This phone number is already registered",
          });
        }

        req.user.phone = cleanNewPhone;
        req.user.otp_val = undefined;
        req.user.otp_expires_at = undefined;
        await req.user.save();

        res.json({success: true,
          message: "Phone number updated successfully",
          user: userResponse(req.user),
        });
      } catch (err) {
        res.status(500).json({success: false, detail: "Internal server error"});
      }
    },
);

router.route("/change-password").post(
    requireAuth,
    async (req, res) => {
      const {otp, new_password: newPassword} = req.body;
      const cleanOtp = typeof otp === "string" ? otp.trim() : "";

      if (!cleanOtp) {
        return res.status(400).json({
          success: false,
          detail: "OTP is required",
        });
      }
      if (
        !newPassword ||
        typeof newPassword !== "string" ||
        newPassword.length < 6
      ) {
        return res.status(400).json({
          success: false,
          detail: "Password must be at least 6 characters",
        });
      }

      try {
        if (!req.user.otp_val) {
          return res.status(400).json({
            success: false,
            detail: "No OTP found. Please request a new one.",
          });
        }
        if (req.user.otp_expires_at < new Date()) {
          return res.status(400).json({
            success: false,
            detail: "OTP has expired. Please request a new one.",
          });
        }
        if (req.user.otp_val !== cleanOtp) {
          return res.status(400).json({
            success: false,
            detail: "Invalid OTP. Please try again.",
          });
        }

        req.user.password_hash = bcrypt.hashSync(newPassword, 10);
        req.user.otp_val = undefined;
        req.user.otp_expires_at = undefined;
        await req.user.save();

        res.json({success: true, message: "Password changed successfully"});
      } catch (err) {
        res.status(500).json({success: false, detail: "Internal server error"});
      }
    },
);

module.exports = router;
