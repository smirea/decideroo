import createLocalStorage from './createLocalStorage.ts';

type StoredSoundChoice = {
	choice: 'yes' | 'no';
	at: number;
};

type StoredSoundToggle = {
	on: boolean;
	at: number;
};

type DecidarooLocalStorage = {
	'last-theme-song'?: string;
	'sound-choice'?: StoredSoundChoice;
	'sound-on'?: StoredSoundToggle;
	'player-name'?: string;
};

const searchParams = new URLSearchParams(location.search);

export const DEBUG_ID = searchParams.get('DEBUG_ID') || searchParams.get('debug_id') || null;

export const { LS, useLocalStorage } = createLocalStorage<DecidarooLocalStorage>({
	namespace: 'decideroo' + (DEBUG_ID ? '-DEBUG_ID=' + DEBUG_ID : ''),
});
