import { query } from "../db/index.js";


export async function getUserChats(userId){
    const result = await query("SELECT id, title, created_at, updated_at FROM chats WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    return result.rows;
}

export async function getChatMessages(chatId){
    const result = await query("SELECT id, role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC", [chatId]);
    return result.rows;
}

export async function saveMessage(chatId, role, content){
    const result = await query("INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3) RETURNING *", [chatId, role, content]);
    return result.rows[0];
}

export async function createChat(userId, title = "New Chat"){
    const result = await query(
        "INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING *", 
        [userId, title]
    );
    return result.rows[0];
}

export async function updateChatTitle(chatId, title){
    const result = await query(
        "UPDATE chats SET title = $1 WHERE id = $2 RETURNING *", 
        [title, chatId]
    );
    return result.rows[0];
}