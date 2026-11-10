const expmod = require("express");
const ChatMessage =
    require("../models/chatmessage.model");
const ChatConversation =
    require("../models/chatconversation.model");
const {requireAuth} = require("../middleware/auth");

const router = new expmod.Router();

const SUPPORTED_LANGUAGES = ["ta", "pa", "en"];
const MAX_SEARCH_LENGTH = 100;
const MAX_TITLE_LENGTH = 80;

/**
 * Escapes a string for literal use inside a RegExp.
 * @param {string} value - Raw text.
 * @return {string} Escaped text.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Creates a body field validation error.
 * @param {string} field - Field name.
 * @param {string} msg - Error message.
 * @param {string} type - Error type.
 * @return {Object} Error response object.
 */
function bodyError(field, msg, type) {
  return {
    success: false,
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
    client_id: m.client_id || null,
    conversation_id: m.conversation_id,
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
      success: false,
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
    (typeof item.conversation_id !== "string" ||
    item.conversation_id.length === 0 ||
    item.conversation_id.length > 64 ||
    item.conversation_id === "legacy")
  ) {
    return {
      success: false,
      detail: [
        {
          loc: [...loc, "conversation_id"],
          msg: "conversation_id must be a valid conversation ID",
          type: "value_error",
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
      success: false,
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
      success: false,
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
      success: false,
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
      success: false,
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
            .json({
              success: false,
              ...bodyError(
                  "items",
                  "List should have at least 1 item",
                  "too_short",
              ),
            });
      }
      for (let i = 0; i < items.length; i++) {
        const error = validateSyncItem(items[i], i);
        if (error) {
          return res.status(422).json({success: false, ...error});
        }
      }
      const docs = items.map((item) => ({
        user_id: req.user._id,
        client_id: item.client_id,
        conversation_id: item.conversation_id,
        language: item.language || "en",
        user_text: item.user_text,
        reply_text: item.reply_text,
        created_at: new Date(item.created_at),
      }));
      try {
        const result = await ChatMessage.bulkWrite(
            docs.map((doc) => ({
              updateOne: {
                filter: {
                  user_id: doc.user_id,
                  client_id: doc.client_id,
                },
                update: {$set: doc},
                upsert: true,
              },
            })),
            {ordered: false},
        );
        const saved = (result.upsertedCount || 0) + (result.matchedCount || 0);
        res.json({success: true,
          saved: saved,
          skipped: items.length - saved,
        });
      } catch (err) {
        if (
          err.code === 11000 &&
          Array.isArray(err.insertedDocs)
        ) {
          const saved = err.insertedDocs.length;
          return res.json({success: true,
            saved: saved,
            skipped: items.length - saved,
          });
        }
        res.status(500).json({success: false,
          detail: "Internal server error",
        });
      }
    },
);

router.route("/conversations").get(
    requireAuth,
    async (req, res) => {
      let limit = 50;
      if (req.query.limit !== undefined) {
        limit = parseInt(req.query.limit, 10);
        if (isNaN(limit) || limit < 1 || limit > 200) {
          return res.status(422).json({
            success: false,
            detail: "limit must be between 1 and 200",
          });
        }
      }
      const query = typeof req.query.q === "string" ?
        req.query.q.trim().slice(0, MAX_SEARCH_LENGTH) : "";
      try {
        const match = {
          user_id: req.user._id,
          conversation_id: {
            $exists: true,
            $type: "string",
            $nin: ["", "legacy"],
          },
        };
        if (query) {
          const pattern = new RegExp(escapeRegex(query), "i");
          const [messageIds, titleIds] = await Promise.all([
            ChatMessage.distinct("conversation_id", {
              user_id: req.user._id,
              $or: [{user_text: pattern}, {reply_text: pattern}],
            }),
            ChatConversation.distinct("conversation_id", {
              user_id: req.user._id,
              title: pattern,
            }),
          ]);
          match.conversation_id = {$in: [...messageIds, ...titleIds]};
        }
        const conversations = await ChatMessage.aggregate([
          {$match: match},
          {$sort: {created_at: 1}},
          {$group: {
            _id: "$conversation_id",
            title: {$first: "$user_text"},
            created_at: {$first: "$created_at"},
            updated_at: {$last: "$created_at"},
            preview: {$last: "$user_text"},
            message_count: {$sum: 1},
          }},
          {$sort: {updated_at: -1}},
          {$limit: limit},
        ]);
        const overrides = await ChatConversation.find({
          user_id: req.user._id,
          conversation_id: {$in: conversations.map((c) => c._id)},
        }).lean();
        const titleById = new Map(
            overrides.map((o) => [o.conversation_id, o.title]),
        );
        res.json({
          success: true,
          data: conversations.map((conversation) => ({
            id: conversation._id,
            title: titleById.get(conversation._id) || conversation.title,
            created_at: conversation.created_at.toISOString(),
            updated_at: conversation.updated_at.toISOString(),
            preview: conversation.preview,
            message_count: conversation.message_count,
          })),
        });
      } catch (err) {
        res.status(500).json({success: false, detail: "Internal server error"});
      }
    },
);

router.route("/conversations/:conversationId/messages").get(
    requireAuth,
    async (req, res) => {
      let limit = 200;
      if (req.query.limit !== undefined) {
        limit = parseInt(req.query.limit, 10);
        if (isNaN(limit) || limit < 1 || limit > 500) {
          return res.status(422).json({
            success: false,
            detail: "limit must be between 1 and 500",
          });
        }
      }
      const conversationId = req.params.conversationId;
      if (!conversationId || conversationId === "legacy") {
        return res.status(422).json({
          success: false,
          detail: "A valid conversation ID is required",
        });
      }
      try {
        const messages = await ChatMessage.find({
          user_id: req.user._id,
          conversation_id: conversationId,
        })
            .sort({created_at: 1})
            .limit(limit);
        res.json({
          success: true,
          data: messages.map(messageResponse),
        });
      } catch (err) {
        res.status(500).json({success: false, detail: "Internal server error"});
      }
    },
);

router.route("/conversations/:conversationId")
    .patch(
        requireAuth,
        async (req, res) => {
          const conversationId = req.params.conversationId;
          if (!conversationId || conversationId === "legacy") {
            return res.status(422).json({
              success: false,
              detail: "A valid conversation ID is required",
            });
          }
          const title = typeof req.body === "object" && req.body &&
            typeof req.body.title === "string" ? req.body.title.trim() : "";
          if (!title || title.length > MAX_TITLE_LENGTH) {
            return res.status(422).json({
              success: false,
              detail: `title must be 1-${MAX_TITLE_LENGTH} characters`,
            });
          }
          try {
            const exists = await ChatMessage.exists({
              user_id: req.user._id,
              conversation_id: conversationId,
            });
            if (!exists) {
              return res.status(404).json({
                success: false,
                detail: "Conversation not found",
              });
            }
            await ChatConversation.updateOne(
                {user_id: req.user._id, conversation_id: conversationId},
                {$set: {title: title, updated_at: new Date()}},
                {upsert: true},
            );
            res.json({
              success: true,
              data: {id: conversationId, title: title},
            });
          } catch (err) {
            res.status(500).json({success: false, detail: "Internal server error"});
          }
        },
    )
    .delete(
        requireAuth,
        async (req, res) => {
          const conversationId = req.params.conversationId;
          if (!conversationId || conversationId === "legacy") {
            return res.status(422).json({
              success: false,
              detail: "A valid conversation ID is required",
            });
          }
          try {
            const result = await ChatMessage.deleteMany({
              user_id: req.user._id,
              conversation_id: conversationId,
            });
            if (!result.deletedCount) {
              return res.status(404).json({
                success: false,
                detail: "Conversation not found",
              });
            }
            await ChatConversation.deleteOne({
              user_id: req.user._id,
              conversation_id: conversationId,
            });
            res.json({
              success: true,
              data: {id: conversationId, deleted: result.deletedCount},
            });
          } catch (err) {
            res.status(500).json({success: false, detail: "Internal server error"});
          }
        },
    );

module.exports = router;
