import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export function currentTimestamp() {
    return formatDate(new Date());
}

const formatDate = (date: Date): string => {
    return dayjs(date).tz('Europe/Berlin').format('YYYY-MM-DD_HH-mm');
};
