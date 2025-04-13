import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

const JWT_EXPIRES_IN = "24h";

const refreshTokenExpiresIn = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

//password hashing

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
};

//compare passwords

export const comparePasswords = async (
  password: string,
  hashedPassword: string
): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

// Token generation
export function generateTokens(
  userId: string,
  email: string
): { accessToken: string; refreshToken: string; expiresAt: number } {
  // Create access token
  const accessToken = jwt.sign({ userId, email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
  // Create refresh token (longer lived)
  const refreshToken = crypto.randomBytes(40).toString("hex");

  // Calculate expiration
  const expiresAt = Date.now() + refreshTokenExpiresIn;

  return {
    accessToken,
    refreshToken,
    expiresAt,
  };
}

// Token verification
export function verifyToken(
  token: string
): { userId: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };
    return decoded;
  } catch (error) {
    return null;
  }
}

// Generate verification token
export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
