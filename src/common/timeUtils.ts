import moment from 'moment';

export function currentTimestamp() {
    return formatDate(new Date());
}

export function formatTimestamp(unixTimestamp: number): string {
    const convertedDate = new Date(unixTimestamp * 1000);
    return formatDate(convertedDate);
}

const formatDate = (date: Date): string => {
    return moment(date).format('DD-MM-YYYY_HH-mm-ss');
};
