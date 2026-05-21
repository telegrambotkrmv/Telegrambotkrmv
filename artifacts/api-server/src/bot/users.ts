import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";

const USERS_FILE = path.join("/tmp", "bot_users.json");

function loadUsers(): Set<number> {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")) as number[];
      return new Set(data);
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load users file");
  }
  return new Set();
}

function saveUsers(users: Set<number>) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify([...users]), "utf-8");
  } catch (err) {
    logger.warn({ err }, "Failed to save users file");
  }
}

const users = loadUsers();

export function registerUser(userId: number) {
  if (!users.has(userId)) {
    users.add(userId);
    saveUsers(users);
  }
}

export function getAllUsers(): number[] {
  return [...users];
}

export function getUserCount(): number {
  return users.size;
}
