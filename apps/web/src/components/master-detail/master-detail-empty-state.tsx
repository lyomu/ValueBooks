export function MasterDetailEmptyState({ title }: { title: string }) {
  return (
    <p className="rb-master-detail__none rb-record-workspace__none">
      No matching {title.toLowerCase()}.
    </p>
  );
}
