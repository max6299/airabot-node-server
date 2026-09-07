const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res
        .status(401)
        .json({detail: "Invalid or expired token"});
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    if (decoded.type !== "access") {
      return res
          .status(401)
          .json({detail: "Invalid or expired token"});
    }
    User.findById(decoded.sub)
        .then((user) => {
          if (!user) {
            return res
                .status(401)
                .json({detail: "Invalid or expired token"});
          }
          req.user = user;
          next();
        })
        .catch(() => {
          res
              .status(401)
              .json({detail: "Invalid or expired token"});
        });
  } catch (err) {
    return res
        .status(401)
        .json({detail: "Invalid or expired token"});
  }
}

module.exports = {requireAuth};
