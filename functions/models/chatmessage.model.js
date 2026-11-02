const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const chatMessageSchema = new Schema(
    {
      user_id: {type: Schema.Types.ObjectId, ref: "User", required: true},
      client_id: {type: String},
      conversation_id: {
        type: String,
        required: true,
        minlength: 1,
        maxlength: 64,
        validate: (value) => value !== "legacy",
      },
      language: {type: String, required: true},
      user_text: {type: String, required: true},
      reply_text: {type: String, required: true},
      created_at: {type: Date, default: Date.now},
    },
    {
      timestamps: false,
    },
);

chatMessageSchema.index(
    {user_id: 1, client_id: 1},
    {unique: true, partialFilterExpression: {client_id: {$type: "string"}}},
);
chatMessageSchema.index({user_id: 1, conversation_id: 1, created_at: 1});

const ChatMessage = mongoose.model("chatmessage", chatMessageSchema);

module.exports = ChatMessage;
