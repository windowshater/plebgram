import { client } from "../config/db.js";
import { User } from "../models/user.js";

export class UserService {
    async getUser(userId: string) {
        const cliente = await client.get(userId);
        return cliente;
    }
    async createUser(user: User) {
        const serielizedUser = JSON.stringify(user);
        const newUser = await client.set(user.id!, serielizedUser);
        return newUser;
    }
    async editUser(user: User) {
        const serielizedUser = JSON.stringify(user);
        const newUser = await client.set(user.id!, serielizedUser);
        return newUser;
    }
    // This maybe will never be used
    async deleteUser(userId: string) {
        const deletedUser = await client.del(userId);
        return deletedUser;
    }
}
