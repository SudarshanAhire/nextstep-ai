
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

      const newUser = await db.user.create({
        data: {
          clerkUserId: user.id,
          name,
          imageUrl: user.imageUrl,
          email: user.emailAddresses[0].emailAddress,
        },
      });

      return newUser;
    } catch (dbError) {
      console.error("Database error in checkUser:", dbError.message);
      throw new Error(`Failed to check/create user: ${dbError.message}`);
    }
  } catch (error) {
    console.error("Error in checkUser:", error.message || error);
    throw error;
  }
};