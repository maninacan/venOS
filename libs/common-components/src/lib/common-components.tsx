export function Placeholder({ label = 'Placeholder' }: { label?: string }) {
  return <div className="p-4 text-gray-700">{label}</div>;
}

export default Placeholder;
