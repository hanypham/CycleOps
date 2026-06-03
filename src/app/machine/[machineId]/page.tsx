/**
 * /machine/:machineId — NFC entry point
 *
 * This is the page the customer lands on after tapping the NFC tag.
 * It's a server component that passes machine data to the client-side payment form.
 */

import { Metadata } from "next";
import { notFound } from "next/navigation";
import PaymentForm from "./PaymentForm";

interface PageProps {
  params: { machineId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return {
    title: `Laundry Day — ${params.machineId}`,
  };
}

export default function MachinePage({ params }: PageProps) {
  // Pass the machine slug to the client component — it fetches machine details via API
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 to-white flex flex-col items-center justify-start px-4 pt-8 pb-12">
      <PaymentForm machineSlug={params.machineId} />
    </main>
  );
}
