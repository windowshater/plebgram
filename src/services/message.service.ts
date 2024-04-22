import { client } from "../config/db.js";

export class MessageService {
    async getMessage(id: string) {
        const message = await client.get(id);
        if (message) {
            return JSON.parse(message);
        }
        return null;
    }
    async createMessage(message: any) {
        const serielizedMesaage = JSON.stringify(message);
        const newMessage = await client.set(
            String(message.message_id),
            serielizedMesaage
        );
        return newMessage;
    }
    async editMessage(message: any) {
        const serielizedMessage = JSON.stringify(message);
        const newMessage = await client.set(
            String(message.message_id),
            serielizedMessage
        );
        return newMessage;
    }
}
