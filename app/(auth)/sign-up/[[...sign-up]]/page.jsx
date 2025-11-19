import React from 'react'
import { SignUp } from "@clerk/nextjs";

const page = () => {
  return (
    <SignUp />
  )
}

export default page

export const dynamic = "force-dynamic";
