
import { currentUser } from "@clerk/nextjs/server";
import { db } from "./prisma";

export const checkUser = async () => {
  try {
    const user = await currentUser();

    if (!user) {
      return null;
    }

    try {
      const loggedInUser = await db.user.findUnique({
        where: {
          clerkUserId: user.id,
        },
      });

      if (loggedInUser) {
        return loggedInUser;
      }

      const name = `${user.firstName} ${user.lastName}`;
      const email = user.emailAddresses[0]?.emailAddress;

      try {
        const newUser = await db.user.create({
          data: {
            clerkUserId: user.id,
            name,
            imageUrl: user.imageUrl,
            email,
          },
        });

        return newUser;
      } catch (createError) {
        // Handle unique constraint violation - user might have been created by another request
        if (createError.code === 'P2002') {
          console.warn("User already exists (unique constraint), fetching existing user");
          const existingUser = await db.user.findUnique({
            where: {
              clerkUserId: user.id,
            },
          });
          
          if (existingUser) {
            return existingUser;
          }
          
          // If still not found, try by email
          const userByEmail = await db.user.findUnique({
            where: {
              email,
            },
          });
          
          if (userByEmail) {
            return userByEmail;
          }
        }
        
        throw createError;
      }
    } catch (dbError) {
      console.error("Database error in checkUser:", dbError.message);
      throw new Error(`Failed to check/create user: ${dbError.message}`);
    }
  } catch (error) {
    console.error("Error in checkUser:", error.message || error);
    throw error;
  }
};