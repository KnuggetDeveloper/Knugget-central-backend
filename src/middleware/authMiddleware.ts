import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/auth";
import prisma from "../config/prismaClient";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    image: string;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify JWT token
    const decoded = verifyToken(token);

    if (!decoded) {
      console.error("Auth error: Invalid token");
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const userId = decoded.userId;

    // Find user in database
    let dbUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!dbUser) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Attach user data to req
    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name || "",
      image: dbUser.imageUrl || "",
    };

    return next();
  } catch (err) {
    console.error("Auth Middleware Error:", err);
    res.status(500).json({ error: "Authentication middleware failed" });
  }
};
