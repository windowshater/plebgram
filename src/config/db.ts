import { createClient } from "redis";

export const client = createClient();
console.log("Client connected to redis");
