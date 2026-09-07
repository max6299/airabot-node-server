const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const chatMessageSchema = new Schema(
    {
      user_id: {type: Schema.Types.ObjectId, ref: "User", required: true},
      client_id: {type: String},
      language: {type: String, required: true},
      user_text: {type: String, required: true},
      reply_text: {type: String, required: true},
      created_at: {type: Date, default: Date.now},
    },
    {
      timestamps: false,
      collection: "chat_messages",
    },
);

chatMessageSchema.index(
    {user_id: 1, client_id: 1},
    {unique: true, partialFilterExpression: {client_id: {$type: "string"}}},
);

const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

module.exports = ChatMessage;
