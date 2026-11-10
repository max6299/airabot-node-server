const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const chatConversationSchema = new Schema(
    {
      user_id: {type: Schema.Types.ObjectId, ref: "User", required: true},
      conversation_id: {type: String, required: true, minlength: 1, maxlength: 64},
      title: {type: String, required: true, maxlength: 80},
      updated_at: {type: Date, default: Date.now},
    },
    {
      timestamps: false,
    },
);

chatConversationSchema.index({user_id: 1, conversation_id: 1}, {unique: true});

const ChatConversation = mongoose.model("chatconversation", chatConversationSchema);

module.exports = ChatConversation;
