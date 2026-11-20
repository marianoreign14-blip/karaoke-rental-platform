export function formatRentalDuration(startsInput: string, endsInput: string): string {
  if (!startsInput || !endsInput) {
    return '';
  }
  const starts = new Date(startsInput);
  const ends = new Date(endsInput);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
    return '';
  }
  const totalMinutes = Math.round((ends.getTime() - starts.getTime()) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`);
  return parts.join(', ');
}
