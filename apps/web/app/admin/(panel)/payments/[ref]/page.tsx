import { PaymentDetail } from '@/components/admin/PaymentDetail';

/** I24 · Plan payment detail & refund */
export default async function AdminPaymentPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <PaymentDetail paymentRef={decodeURIComponent(ref)} />;
}
