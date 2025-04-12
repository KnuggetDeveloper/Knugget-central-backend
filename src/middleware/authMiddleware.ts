// src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import prisma from "../config/prismaClient";
dotenv.config();

// Create Supabase client with better error handling
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase configuration. Please check environment variables.");
}

const supabase = createClient(
  supabaseUrl || "",
  supabaseServiceKey || ""
);

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
    // Validate with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error("Auth error:", error?.message || "Invalid token");
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    try {
      // Check if user exists in local database
      let dbUser = await prisma.user.findUnique({
        where: { id: user.id },
      });

      // Create or update user in local DB
      if (!dbUser) {
        try {
          // Create new user
          dbUser = await prisma.user.create({
            data: {
              id: user.id,
              email: user.email!,
              name: user.user_metadata.full_name || "New User",
              imageUrl: user.user_metadata.avatar_url || undefined,
              provider: user.user_metadata.provider || "supabase",
              credits: 10, // Initial free credits
            },
          });
        } catch (createError) {
          console.error("Failed to create user in database:", createError);
          // Continue with Supabase user data
        }
      } else {
        try {
          // Update existing user
          dbUser = await prisma.user.update({
            where: { id: user.id },
            data: {
              email: user.email!,
              name: user.user_metadata.full_name || dbUser.name,
              imageUrl: user.user_metadata.avatar_url || dbUser.imageUrl,
              provider: user.user_metadata.provider || dbUser.provider || "supabase",
            },
          });
        } catch (updateError) {
          console.error("Failed to update user in database:", updateError);
          // Continue with existing dbUser data
        }
      }

      req.user = {
        id: user.id,
        email: user.email!,
        name: user.user_metadata.full_name || (dbUser?.name || ""),
        image: user.user_metadata.avatar_url || (dbUser?.imageUrl || ""),
      };

      return next();
    } catch (dbError) {
      console.error("Database error in auth middleware:", dbError);

      // In case of database error, still authenticate with Supabase data only
      req.user = {
        id: user.id,
        email: user.email!,
        name: user.user_metadata.full_name || "",
        image: user.user_metadata.avatar_url || "",
      };

      return next();
    }
  } catch (err) {
    console.error("Auth Middleware Error:", err);
    res.status(500).json({ error: "Authentication middleware failed" });
  }
};