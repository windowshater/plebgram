import { UserService } from "../services/user.service.js";
const userService = new UserService();

export async function isUserRegistered(tgUserId: string) {
    const user = await userService.getUser(tgUserId);
    console.log("user is", user);
    if (user) {
        return true;
    }
    return false;
}
