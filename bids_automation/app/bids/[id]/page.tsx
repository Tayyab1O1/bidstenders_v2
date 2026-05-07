import BidWorkspace from './BidWorkspace';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BidWorkspace bidId={id} />;
}
