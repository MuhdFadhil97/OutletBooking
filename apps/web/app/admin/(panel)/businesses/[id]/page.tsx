import { BusinessDetail } from '@/components/admin/BusinessDetail';

/** I2 · Business detail */
export default async function AdminBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BusinessDetail id={Number(id)} />;
}
