export const dynamic = "force-dynamic";

import React from 'react'
import { industries } from '@/data/industries'
import { getUserOnboardingStatus } from '@/actions/user'
import { redirect } from 'next/navigation'
import OnboardingForm from "./_components/onboarding-form";


const OnboardingPage = async() => {
  // check if user is already onboarded 
  const {isOnboarded} = await getUserOnboardingStatus();

  if(isOnboarded){
    redirect('/dashboard');
  }

  return (
    <main>
      <OnboardingForm industries={industries}/>
    </main>
  )
}

export default OnboardingPage
