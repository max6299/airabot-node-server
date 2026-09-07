const expmod = require("express");
const ChatMessage =
    require("../models/chatmessage.model");
const {requireAuth} = require("../middleware/auth");

const router = new expmod.Router();

const SUPPORTED_LANGUAGES = ["ta", "pa", "en"];

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
 * Formats a chat message for API responses.
 * @param {Object} m - Mongoose chat message document.
 * @return {Object} Formatted message object.
 */
function messageResponse(m) {
  return {
    id: m._id.toString(),
    language: m.language,
    user_text: m.user_text,
    reply_text: m.reply_text,
    created_at: m.created_at.toISOString(),
  };
}

/**
 * Validates a single sync item payload.
 * @param {Object} item - The item to validate.
 * @param {number} index - The item index in the array.
 * @return {Object|null} Error object or null.
 */
function validateSyncItem(item, index) {
  const loc = ["body", "items", index];
  if (
    typeof item.client_id !== "string" ||
    item.client_id.length === 0 ||
    item.client_id.length > 64
  ) {
    return {
      detail: [
        {
          loc: loc,
          msg: "String should have " +
            "at most 64 characters",
          type: "string_too_long",
        },
      ],
    };
  }
  if (
    item.language !== undefined &&
    (typeof item.language !== "string" ||
    !SUPPORTED_LANGUAGES.includes(item.language))
  ) {
    return {
      detail: [
        {
          loc: [...loc, "language"],
          msg: "language must be one of: ta, pa, en",
          type: "value_error",
        },
      ],
    };
  }
  if (
    typeof item.user_text !== "string" ||
    item.user_text.length === 0 ||
    item.user_text.length > 2000
  ) {
    return {
      detail: [
        {
          loc: [...loc, "user_text"],
          msg: "String should have " +
            "at most 2000 characters",
          type: "string_too_long",
        },
      ],
    };
  }
  if (
    typeof item.reply_text !== "string" ||
    item.reply_text.length === 0 ||
    item.reply_text.length > 4000
  ) {
    return {
      detail: [
        {
          loc: [...loc, "reply_text"],
          msg: "String should have " +
            "at most 4000 characters",
          type: "string_too_long",
        },
      ],
    };
  }
  if (
    typeof item.created_at !== "string" ||
    isNaN(new Date(item.created_at).getTime())
  ) {
    return {
      detail: [
        {
          loc: [...loc, "created_at"],
          msg: "Input should be a valid datetime",
          type: "datetime_from_date_parsing",
        },
      ],
    };
  }
  return null;
}

router.route("/sync").post(
    requireAuth,
    async (req, res) => {
      const items = req.body.items;
      if (
        !Array.isArray(items) ||
        items.length === 0 ||
        items.length > 200
      ) {
        return res
            .status(422)
            .json(
                bodyError(
                    "items",
                    "List should have at least 1 item",
                    "too_short",
                ),
            );
      }
      for (let i = 0; i < items.length; i++) {
        const error = validateSyncItem(items[i], i);
        if (error) {
          return res.status(422).json(error);
        }
      }
      const docs = items.map((item) => ({
        user_id: req.user._id,
        client_id: item.client_id,
        language: item.language || "en",
        user_text: item.user_text,
        reply_text: item.reply_text,
        created_at: new Date(item.created_at),
      }));
      try {
        const result = await ChatMessage.insertMany(
            docs,
            {ordered: false},
        );
        const saved = result.length;
        res.json({
          saved: saved,
          skipped: items.length - saved,
        });
      } catch (err) {
        if (
          err.code === 11000 &&
          Array.isArray(err.insertedDocs)
        ) {
          const saved = err.insertedDocs.length;
          return res.json({
            saved: saved,
            skipped: items.length - saved,
          });
        }
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

router.route("/messages").get(
    requireAuth,
    async (req, res) => {
      let limit = 50;
      if (req.query.limit !== undefined) {
        limit = parseInt(req.query.limit, 10);
        if (
          isNaN(limit) ||
          limit < 1 ||
          limit > 200
        ) {
          return res
              .status(422)
              .json({
                detail: [
                  {
                    loc: ["query", "limit"],
                    msg: "Input should be greater " +
                      "than or equal to 1 and " +
                      "less than or equal to 200",
                    type: "greater_than_equal",
                  },
                ],
              });
        }
      }
      try {
        const messages = await ChatMessage.find({
          user_id: req.user._id,
        })
            .sort({created_at: -1})
            .limit(limit);
        res.json(messages.map(messageResponse));
      } catch (err) {
        res.status(500).json({
          detail: "Internal server error",
        });
      }
    },
);

module.exports = router;
