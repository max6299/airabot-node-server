const expmod = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const {requireAuth} = require("../middleware/auth");

const router = new expmod.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validationError(detail) {
  return {detail: detail};
}

function bodyError(field, msg, type) {
  return validationError([{loc: ["body", field], msg: msg, type: type}]);
}

function userResponse(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    location: user.location,
    district: user.district,
    created_at: user.createdAt.toISOString(),
  };
}

function createAccessToken(userId) {
  return jwt.sign(
      {sub: userId, type: "access", iat: Math.floor(Date.now() / 1000)},
      process.env.SECRET_KEY,
      {expiresIn: process.env.ACCESS_TOKEN_EXPIRE_MINUTES + "m"},
  );
}

function createRefreshToken(userId) {
  return jwt.sign(
      {
        sub: userId,
        type: "refresh",
        tokenType: "RefToken",
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.REF_TOKEN_SECRET,
      {expiresIn: process.env.REFRESH_TOKEN_EXPIRE_DAYS + "d"},
  );
}

function tokenResponse(user) {
  return {
    access_token: createAccessToken(user._id.toString()),
    refresh_token: createRefreshToken(user._id.toString()),
    token_type: "bearer",
    expires_in: parseInt(process.env.ACCESS_TOKEN_EXPIRE_MINUTES, 10) * 60,
  };
}

router.route("/register").post(async (req, res) => {
  const name = req.body.name;
  const email = req.body.email;
  const password = req.body.password;

  if (typeof name !== "string" || name.trim().length === 0) {
    return res
        .status(422)
        .json(bodyError("name", "Field required", "value_error.missing"));
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res
        .status(422)
        .json(bodyError("email", "value is not a valid email address", "value_error"));
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res
        .status(422)
        .json(bodyError("password", "String should have at least 8 characters", "string_too_short"));
  }

  const cleanEmail = email.trim().toLowerCase();
  try {
    const existing = await User.findOne({email: cleanEmail});
    if (existing) {
      return res.status(409).json({detail: "Email already registered"});
    }
    const user = new User({
      name: name.trim(),
      email: cleanEmail,
      password_hash: bcrypt.hashSync(password, 10),
    });
    await user.save();
    res.status(201).json({
      ...tokenResponse(user),
      user: userResponse(user),
    });
  } catch (err) {
    res.status(500).json({detail: "Internal server error"});
  }
});

router.route("/login").post(async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  if (typeof email !== "string" || typeof password !== "string" || password.length === 0) {
    return res
        .status(422)
        .json(bodyError("password", "Field required", "value_error.missing"));
  }

  try {
    const user = await User.findOne({email: email.trim().toLowerCase()});
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res
          .status(401)
          .json({detail: "Invalid email or password"});
    }
    res.json({
      ...tokenResponse(user),
      user: userResponse(user),
    });
  } catch (err) {
    res.status(500).json({detail: "Internal server error"});
  }
});

router.route("/refresh").post(async (req, res) => {
  const refreshToken = req.body.refresh_token;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    return res
        .status(422)
        .json(bodyError("refresh_token", "Field required", "value_error.missing"));
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.REF_TOKEN_SECRET);
    if (decoded.type !== "refresh") {
      return res
          .status(401)
          .json({detail: "Invalid refresh token"});
    }
    const user = await User.findById(decoded.sub);
    if (!user) {
      return res
          .status(401)
          .json({detail: "Invalid refresh token"});
    }
    res.json(tokenResponse(user));
  } catch (err) {
    return res
        .status(401)
        .json({detail: "Invalid refresh token"});
  }
});

router.route("/me").get(requireAuth, (req, res) => {
  res.json(userResponse(req.user));
});

router.route("/me").patch(requireAuth, async (req, res) => {
  const location = req.body.location;
  const district = req.body.district;

  if (typeof location !== "string") {
    return res
        .status(422)
        .json(bodyError("location", "Field required", "value_error.missing"));
  }
  if (typeof district !== "string") {
    return res
        .status(422)
        .json(bodyError("district", "Field required", "value_error.missing"));
  }

  req.user.location = location.trim();
  req.user.district = district.trim();
  try {
    await req.user.save();
    res.json(userResponse(req.user));
  } catch (err) {
    res.status(500).json({detail: "Internal server error"});
  }
});

router.route("/push-token").put(requireAuth, async (req, res) => {
  const pushToken = req.body.push_token;
  if (typeof pushToken !== "string" || pushToken.trim().length === 0) {
    return res
        .status(422)
        .json(bodyError("push_token", "Field required", "value_error.missing"));
  }
  req.user.push_token = pushToken.trim();
  try {
    await req.user.save();
    res.json(userResponse(req.user));
  } catch (err) {
    res.status(500).json({detail: "Internal server error"});
  }
});

module.exports = router;
