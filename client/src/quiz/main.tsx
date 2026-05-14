import { Boot, Headphones, SpeakerHigh, SpeakerSlash, UserCircle } from '@phosphor-icons/react';
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FormEvent,
	type ReactNode,
} from 'react';
import { Button } from '../components/Button.tsx';
import { useGameServer } from '../hooks/useGameServerver.ts';
import { LS } from '../utils/utils.ts';
import { decidingOptions } from '../../../shared/constants.ts';
import { QuestionScoreList } from './questionScoreList.tsx';
import {
	emptyOptionPoints,
	scoreInputToPoints,
	sumOptionPoints,
	type OptionPoints,
	type QuizDefinition,
	type ScoreDetail,
} from './quizScreen.tsx';
import type { GamePlayer, GameState, PlayerProgress, QuizResult } from '../../../shared/game.ts';
import { asteroidsQuiz } from './asteroids.tsx';
import { cockpitQuiz } from './cockpit.tsx';
import { diceRollQuiz } from './diceRoll.tsx';
import { tinderSwipeQuiz } from './tinderSwipe.tsx';
import { twentyFortyEightQuiz } from './twentyFortyEight.tsx';
import { VersusIntro } from './versusIntro.tsx';

export const quizzes = [tinderSwipeQuiz, diceRollQuiz, twentyFortyEightQuiz, asteroidsQuiz, cockpitQuiz] as const;
const themeSongUrl = '/decidaroo.mp3';
const versusSoundUrl = '/sfx/vs-intro.wav';
const soundChoiceSkipMs = 24 * 60 * 60 * 1000;
const emptyKickVotes: GameState['kickVotes'] = {};

declare global {
	interface Window {
		DEBUG?: {
			restartGame?: () => Promise<GameState | null>;
			[key: string]: unknown;
		};
	}
}

type SoundChoice = 'yes' | 'no';

type StoredSoundChoice = {
	choice: SoundChoice;
	at: number;
};

type PointerTarget = {
	clientX: number;
	clientY: number;
};

type EyeLook = {
	x: number;
	y: number;
};

type EyeLooks = {
	left: EyeLook;
	right: EyeLook;
};

type GroupScoreRow = {
	id: string;
	quizId: string;
	quizTitle: string;
	label: string;
	kind: 'screen' | 'single' | 'summary';
	pointsByPlayer: Record<string, OptionPoints>;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function screenTitle(screen: unknown, index: number) {
	if (typeof screen !== 'object' || screen === null) return `Screen ${index + 1}`;

	const title = (screen as { title?: unknown }).title;
	return typeof title === 'string' ? title : `Screen ${index + 1}`;
}

function readStoredSoundChoice(): StoredSoundChoice | null {
	try {
		const stored = LS.get('sound-choice');
		if (!stored) return null;

		if ((stored.choice !== 'yes' && stored.choice !== 'no') || typeof stored.at !== 'number') {
			LS.delete('sound-choice');
			return null;
		}

		if (Date.now() - stored.at >= soundChoiceSkipMs) {
			LS.delete('sound-choice');
			return null;
		}

		return { choice: stored.choice, at: stored.at };
	} catch {
		return null;
	}
}

function writeStoredSoundChoice(choice: SoundChoice): StoredSoundChoice {
	const stored = { choice, at: Date.now() };
	LS.set({ 'sound-choice': stored });
	return stored;
}

function hasFreshHeadphoneYes(stored: StoredSoundChoice | null) {
	return stored?.choice === 'yes';
}

function readStoredSoundOn() {
	try {
		const stored = LS.get('sound-on');
		if (!stored) return true;

		if (typeof stored.on !== 'boolean' || typeof stored.at !== 'number') {
			LS.delete('sound-on');
			return true;
		}

		if (Date.now() - stored.at >= soundChoiceSkipMs) {
			LS.delete('sound-on');
			return true;
		}

		return stored.on;
	} catch {
		return true;
	}
}

function writeStoredSoundOn(on: boolean) {
	LS.set({ 'sound-on': { on, at: Date.now() } });
}

function readStoredPlayerName() {
	try {
		return LS.get('player-name')?.trim() ?? '';
	} catch {
		return '';
	}
}

function writeStoredPlayerName(name: string) {
	LS.set({ 'player-name': name });
}

function getInitialSoundState() {
	const stored = readStoredSoundChoice();
	return { stored, showIntro: !hasFreshHeadphoneYes(stored) };
}

function ClubBackground() {
	return (
		<div aria-hidden='true' className='club-background'>
			<span className='club-spotlight club-spotlight-a' />
			<span className='club-spotlight club-spotlight-b' />
			<span className='club-spotlight club-spotlight-c' />
			<span className='club-spotlight club-spotlight-d' />
			<span className='club-spotlight club-spotlight-e' />
			<span className='club-spotlight club-spotlight-f' />
			<span className='club-spotlight club-spotlight-g' />
		</div>
	);
}

function useLogoEyeTracking() {
	const logoRef = useRef<HTMLDivElement | null>(null);
	const leftEyeRef = useRef<HTMLSpanElement | null>(null);
	const rightEyeRef = useRef<HTMLSpanElement | null>(null);
	const [looks, setLooks] = useState<EyeLooks>({
		left: { x: 0.16, y: 0.04 },
		right: { x: 0.16, y: 0.04 },
	});

	useEffect(() => {
		let frame = 0;
		let lastTarget: PointerTarget | null = null;

		const lookForEye = (eye: HTMLSpanElement | null, target: PointerTarget): EyeLook => {
			if (!eye) return { x: 0, y: 0 };

			const rect = eye.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };

			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;

			return {
				x: clamp((target.clientX - centerX) / (rect.width * 0.78), -1, 1),
				y: clamp((target.clientY - centerY) / (rect.height * 0.84), -1, 1),
			};
		};

		const updateLook = () => {
			frame = 0;
			if (!lastTarget) return;

			setLooks({
				left: lookForEye(leftEyeRef.current, lastTarget),
				right: lookForEye(rightEyeRef.current, lastTarget),
			});
		};

		const scheduleLookUpdate = (event: PointerEvent) => {
			lastTarget = { clientX: event.clientX, clientY: event.clientY };
			if (frame === 0) frame = window.requestAnimationFrame(updateLook);
		};

		const syncLastTarget = () => {
			if (lastTarget && frame === 0) frame = window.requestAnimationFrame(updateLook);
		};

		window.addEventListener('pointermove', scheduleLookUpdate, { passive: true });
		window.addEventListener('pointerdown', scheduleLookUpdate, { passive: true });
		window.addEventListener('resize', syncLastTarget);

		return () => {
			window.removeEventListener('pointermove', scheduleLookUpdate);
			window.removeEventListener('pointerdown', scheduleLookUpdate);
			window.removeEventListener('resize', syncLastTarget);
			if (frame !== 0) window.cancelAnimationFrame(frame);
		};
	}, []);

	return { leftEyeRef, logoRef, looks, rightEyeRef };
}

function DiscoLogo() {
	const { leftEyeRef, logoRef, looks, rightEyeRef } = useLogoEyeTracking();
	const leftEyeStyle = {
		'--eye-x': `${looks.left.x * 0.15}em`,
		'--eye-y': `${looks.left.y * 0.12}em`,
	} as CSSProperties;
	const rightEyeStyle = {
		'--eye-x': `${looks.right.x * 0.15}em`,
		'--eye-y': `${looks.right.y * 0.12}em`,
	} as CSSProperties;

	return (
		<div aria-label='decideroo' className='disco-logo' ref={logoRef} role='img'>
			<span aria-hidden='true' className='disco-logo-word'>
				<span className='disco-logo-text'>
					{'decider'.split('').map((letter, index) => (
						<span className='disco-logo-letter' key={`${letter}-${index}`}>
							{letter}
						</span>
					))}
				</span>
				<span className='disco-logo-eye' ref={leftEyeRef} style={leftEyeStyle}>
					<span className='disco-logo-pupil' />
				</span>
				<span className='disco-logo-eye disco-logo-eye-right' ref={rightEyeRef} style={rightEyeStyle}>
					<span className='disco-logo-pupil' />
				</span>
			</span>
		</div>
	);
}

function optionPoint(points: OptionPoints, optionName: string) {
	return points[optionName] ?? 0;
}

function nonZeroOptions(points: OptionPoints) {
	return decidingOptions.filter(option => optionPoint(points, option.name) !== 0);
}

function winningOption(points: OptionPoints) {
	return decidingOptions.reduce((winner, option) =>
		optionPoint(points, option.name) > optionPoint(points, winner.name) ? option : winner,
	);
}

function progressScore(progress: PlayerProgress) {
	return sumOptionPoints([...progress.results.map(result => result.points), ...progress.screenScores]);
}

function hasSavedProgress(player: GamePlayer) {
	return (
		player.quizIndex !== 0 || player.screenIndex !== 0 || player.screenScores.length > 0 || player.results.length > 0
	);
}

function playerFromProgress(name: string, progress: PlayerProgress, endScreenAt?: string): GamePlayer {
	const now = new Date().toISOString();

	return {
		...progress,
		endScreenAt,
		name,
		score: progressScore(progress),
		updatedAt: now,
	};
}

function mergePlayers(players: readonly GamePlayer[], localPlayer: GamePlayer | null) {
	if (!localPlayer) return [...players];

	const existingPlayer = players.find(player => player.name === localPlayer.name);
	if (!existingPlayer) return [...players, localPlayer];

	return players.map(player =>
		player.name === localPlayer.name
			? { ...player, ...localPlayer, endScreenAt: localPlayer.endScreenAt ?? player.endScreenAt }
			: player,
	);
}

function isPlayerDone(player: GamePlayer, quizSet: readonly QuizDefinition[]) {
	return player.results.length >= quizSet.length || player.quizIndex >= quizSet.length;
}

function isPlayerAtEndScreen(player: GamePlayer, quizSet: readonly QuizDefinition[]) {
	return isPlayerDone(player, quizSet) && Boolean(player.endScreenAt);
}

function endScreenPlayerNames(players: readonly GamePlayer[], quizSet: readonly QuizDefinition[]) {
	return players.filter(player => isPlayerAtEndScreen(player, quizSet)).map(player => player.name);
}

function hasKickQuorum(
	player: GamePlayer,
	players: readonly GamePlayer[],
	quizSet: readonly QuizDefinition[],
	kickVotes: GameState['kickVotes'],
) {
	const doneNames = endScreenPlayerNames(players, quizSet);
	const votes = new Set(kickVotes[player.name] ?? []);

	return doneNames.length >= 2 && doneNames.every(name => votes.has(name));
}

function isPlayerKicked(
	player: GamePlayer,
	players: readonly GamePlayer[],
	quizSet: readonly QuizDefinition[],
	kickVotes: GameState['kickVotes'],
) {
	return !isPlayerDone(player, quizSet) && hasKickQuorum(player, players, quizSet, kickVotes);
}

function playerGameStatus(player: GamePlayer, quizSet: readonly QuizDefinition[]) {
	if (isPlayerDone(player, quizSet)) return 'final score';

	return quizSet[player.quizIndex]?.title ?? quizSet[player.results.length]?.title ?? 'done';
}

function playerQuizResult(player: GamePlayer, quiz: QuizDefinition) {
	return player.results.find(result => result.id === quiz.id) ?? null;
}

function groupScoreRows(players: readonly GamePlayer[], quizSet: readonly QuizDefinition[]) {
	return quizSet.flatMap<GroupScoreRow>(quiz => {
		const screenCount = Math.max(
			1,
			...players.map(player => playerQuizResult(player, quiz)?.screens.length ?? quiz.screens.length),
		);

		if (screenCount <= 1) {
			return [
				{
					id: quiz.id,
					quizId: quiz.id,
					quizTitle: quiz.title,
					label: quiz.title,
					kind: 'single',
					pointsByPlayer: Object.fromEntries(
						players.map(player => [player.name, playerQuizResult(player, quiz)?.points ?? emptyOptionPoints()]),
					),
				},
			];
		}

		return [
			{
				id: `${quiz.id}-summary`,
				quizId: quiz.id,
				quizTitle: quiz.title,
				label: quiz.title,
				kind: 'summary',
				pointsByPlayer: {},
			},
			...Array.from({ length: screenCount }, (_, screenIndex) => ({
				id: `${quiz.id}-${screenIndex}`,
				quizId: quiz.id,
				quizTitle: quiz.title,
				label:
					players
						.map(player => playerQuizResult(player, quiz)?.screens[screenIndex]?.title)
						.find(title => typeof title === 'string') ?? screenTitle(quiz.screens[screenIndex], screenIndex),
				kind: 'screen' as const,
				pointsByPlayer: Object.fromEntries(
					players.map(player => [
						player.name,
						playerQuizResult(player, quiz)?.screens[screenIndex]?.points ?? emptyOptionPoints(),
					]),
				),
			})),
		];
	});
}

function groupTallies(rows: readonly GroupScoreRow[], players: readonly GamePlayer[]) {
	const total = emptyOptionPoints();

	for (const row of rows) {
		if (row.kind === 'summary') continue;

		for (const player of players) {
			const points = row.pointsByPlayer[player.name] ?? emptyOptionPoints();
			for (const option of decidingOptions) total[option.name] += points[option.name] ?? 0;
		}
	}

	return total;
}

function ScoreStrip({ points }: { points: OptionPoints }) {
	const options = nonZeroOptions(points);

	if (options.length === 0) return null;

	return (
		<div className='grid shrink-0 grid-flow-col gap-2'>
			{options.map(option => (
				<div
					className='min-w-12 rounded-lg border-2 border-neutral-950 px-2 py-2 text-center text-xl font-black leading-none text-neutral-950 shadow-[3px_3px_0_#171717]'
					key={option.name}
					style={{ backgroundColor: option.color }}
				>
					{optionPoint(points, option.name)}
				</div>
			))}
		</div>
	);
}

function PointsBreakdown({ points }: { points: OptionPoints }) {
	const options = nonZeroOptions(points);

	if (options.length === 0) return null;

	return (
		<div className='grid grid-cols-2 gap-2'>
			{options.map(option => (
				<div
					className='rounded-lg border-2 border-neutral-950 p-2 text-neutral-950 shadow-[3px_3px_0_#171717]'
					key={option.name}
					style={{ backgroundColor: option.color }}
				>
					<p className='truncate text-sm font-black'>{option.name}</p>
					<p className='text-2xl font-black leading-none'>{optionPoint(points, option.name)}</p>
				</div>
			))}
		</div>
	);
}

function ScreenPointChips({ points }: { points: OptionPoints }) {
	const options = nonZeroOptions(points);

	return (
		<div className='flex gap-1'>
			{options.map(option => (
				<span
					className='min-w-7 rounded border border-neutral-950 px-1.5 py-0.5 text-center font-black text-neutral-950'
					key={option.name}
					style={{ backgroundColor: option.color }}
				>
					{optionPoint(points, option.name)}
				</span>
			))}
		</div>
	);
}

function ProgressBar({ progress }: { progress: number }) {
	return (
		<div
			aria-label='Quiz progress'
			aria-valuemax={100}
			aria-valuemin={0}
			aria-valuenow={progress}
			className='h-3 min-w-0 flex-1 overflow-hidden rounded-lg border-2 border-neutral-950 bg-white'
			role='progressbar'
		>
			<div className='h-full bg-emerald-500 transition-all' style={{ width: `${progress}%` }} />
		</div>
	);
}

function LogoHeader() {
	return (
		<header className='relative z-30 flex shrink-0 justify-center'>
			<DiscoLogo />
		</header>
	);
}

function StatusBar({
	points,
	progress,
	soundButton,
}: {
	points: OptionPoints;
	progress: number;
	soundButton: ReactNode;
}) {
	return (
		<footer className='relative z-30 grid w-full shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3'>
			{soundButton}
			<ProgressBar progress={progress} />
			<ScoreStrip points={points} />
		</footer>
	);
}

function TableScoreChips({ points }: { points: OptionPoints | null }) {
	if (!points) return <span className='text-sm font-black text-neutral-400'>?</span>;

	const options = nonZeroOptions(points);

	if (options.length === 0) return <span className='text-xs font-black text-neutral-400'>0</span>;

	return (
		<div className='flex flex-col items-center justify-center gap-1'>
			{options.map(option => (
				<span
					className='min-w-6 rounded border border-neutral-950 px-1 py-0.5 text-center text-xs font-black leading-none text-neutral-950'
					key={option.name}
					style={{ backgroundColor: option.color }}
				>
					{optionPoint(points, option.name)}
				</span>
			))}
		</div>
	);
}

function TallyCards({ points }: { points: OptionPoints }) {
	return (
		<div className='grid shrink-0 grid-cols-2 gap-2'>
			{decidingOptions.map(option => (
				<div
					className='rounded-lg border-2 border-neutral-950 p-2 text-neutral-950 shadow-[3px_3px_0_#171717]'
					key={option.name}
					style={{ backgroundColor: option.color }}
				>
					<p className='truncate text-xs font-black uppercase'>{option.name}</p>
					<p className='text-2xl font-black leading-none'>{optionPoint(points, option.name)}</p>
				</div>
			))}
		</div>
	);
}

function WaitingForPlayers({
	currentPlayerName,
	kickVotes,
	onKick,
	players,
	quizSet,
}: {
	currentPlayerName: string;
	kickVotes: GameState['kickVotes'];
	onKick: (targetName: string) => void;
	players: readonly GamePlayer[];
	quizSet: readonly QuizDefinition[];
}) {
	const currentPlayer = players.find(player => player.name === currentPlayerName);
	const currentPlayerReady = currentPlayer ? isPlayerAtEndScreen(currentPlayer, quizSet) : false;

	return (
		<section className='flex min-h-0 flex-1 flex-col justify-center gap-4'>
			<div className='space-y-2 text-center'>
				<h2 className='text-2xl font-black leading-tight text-neutral-950'>waiting for everyone to finish</h2>
			</div>
			<div className='grid gap-2'>
				{players.map(player => {
					const playerDone = isPlayerDone(player, quizSet);
					const playerReady = isPlayerAtEndScreen(player, quizSet);
					const playerKicked = isPlayerKicked(player, players, quizSet, kickVotes);
					const currentPlayerVoted = (kickVotes[player.name] ?? []).includes(currentPlayerName);
					const canKick = currentPlayerReady && !playerDone && !playerKicked && !currentPlayerVoted;

					return (
						<div
							className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-2 border-neutral-950 bg-neutral-50 p-3 text-neutral-950 shadow-[3px_3px_0_#171717]'
							key={player.name}
						>
							<p className='truncate font-black'>{player.name}</p>
							<div className='flex items-center gap-2'>
								<p className='rounded border-2 border-neutral-950 bg-white px-2 py-1 text-xs font-black uppercase'>
									{playerKicked ? 'ignored' : playerReady ? 'done' : playerGameStatus(player, quizSet)}
								</p>
								{!playerDone && (
									<button
										aria-label={`boot ${player.name}`}
										className={`grid h-9 w-9 place-items-center rounded border-2 border-neutral-950 ${
											currentPlayerVoted || playerKicked
												? 'bg-neutral-950 text-white'
												: 'bg-white text-neutral-950 shadow-[2px_2px_0_#171717]'
										} disabled:cursor-default disabled:opacity-70`}
										disabled={!canKick}
										onClick={() => onKick(player.name)}
										title={`boot ${player.name}`}
										type='button'
									>
										<Boot size={18} weight={currentPlayerVoted || playerKicked ? 'fill' : 'bold'} />
									</button>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function nextGroupRowDelay(rows: readonly GroupScoreRow[], visibleRowCount: number) {
	const currentRow = rows[visibleRowCount - 1];
	const nextRow = rows[visibleRowCount];

	if (!currentRow || !nextRow) return 250;
	if (currentRow.quizId === nextRow.quizId && (currentRow.kind === 'screen' || nextRow.kind === 'screen')) return 500;
	return 2000;
}

function summaryPointsForPlayer(rows: readonly GroupScoreRow[], quizId: string, playerName: string) {
	const screenRows = rows.filter(row => row.quizId === quizId && row.kind === 'screen');
	if (screenRows.length === 0) return null;

	return sumOptionPoints(screenRows.map(row => row.pointsByPlayer[playerName] ?? emptyOptionPoints()));
}

function GroupTallyTable({ players, rows }: { players: readonly GamePlayer[]; rows: readonly GroupScoreRow[] }) {
	const [visibleRowCount, setVisibleRowCount] = useState(0);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const revealKey = rows.map(row => row.id).join('|');
	const visibleRows = rows.slice(0, visibleRowCount);
	const tallies = groupTallies(visibleRows, players);

	useEffect(() => {
		setVisibleRowCount(0);
		if (rows.length === 0) return;

		const timeout = window.setTimeout(() => setVisibleRowCount(1), 250);
		return () => window.clearTimeout(timeout);
	}, [revealKey, rows.length]);

	useEffect(() => {
		if (visibleRowCount === 0 || visibleRowCount >= rows.length) return;

		const timeout = window.setTimeout(
			() => {
				setVisibleRowCount(current => Math.min(current + 1, rows.length));
			},
			nextGroupRowDelay(rows, visibleRowCount),
		);

		return () => window.clearTimeout(timeout);
	}, [rows, visibleRowCount]);

	useEffect(() => {
		const scrollElement = scrollRef.current;
		if (!scrollElement) return;

		scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: 'smooth' });
	}, [visibleRowCount]);

	return (
		<section className='flex min-h-0 flex-1 flex-col gap-3'>
			<div className='min-h-0 flex-1 overflow-auto rounded-lg bg-white' ref={scrollRef}>
				<table className='w-full min-w-[360px] border-separate border-spacing-0 text-neutral-950'>
					<thead className='sticky top-0 z-20'>
						<tr>
							<th className='sticky left-0 z-30 h-16 w-20 border-b-2 border-neutral-950 bg-white px-2 text-left text-xs font-black uppercase'>
								game
							</th>
							{players.map(player => (
								<th className='h-16 w-12 border-b-2 border-neutral-950 bg-white px-1 align-bottom' key={player.name}>
									<div className='flex h-16 items-end justify-center overflow-visible pb-3'>
										<span className='origin-bottom-left -rotate-45 translate-x-2 whitespace-nowrap text-xs font-black'>
											{player.name}
										</span>
									</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{visibleRows.map(row => (
							<tr className='group-tally-row' key={row.id}>
								<th className='sticky left-0 z-10 w-20 border-b border-neutral-200 bg-white px-2 py-2 text-left align-middle'>
									{row.kind === 'screen' ? (
										<span className='ml-2 block text-sm font-normal leading-tight'>{row.label}</span>
									) : (
										<span className='block text-sm font-black leading-tight'>{row.label}</span>
									)}
								</th>
								{players.map(player => {
									const points =
										row.kind === 'summary'
											? summaryPointsForPlayer(visibleRows, row.quizId, player.name)
											: (row.pointsByPlayer[player.name] ?? emptyOptionPoints());

									return (
										<td className='border-b border-neutral-200 px-1 py-2 text-center align-middle' key={player.name}>
											<TableScoreChips points={points} />
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<TallyCards points={tallies} />
		</section>
	);
}

function GroupResultsScreen({
	currentPlayerName,
	kickVotes,
	onKick,
	players,
	quizSet,
}: {
	currentPlayerName: string;
	kickVotes: GameState['kickVotes'];
	onKick: (targetName: string) => void;
	players: readonly GamePlayer[];
	quizSet: readonly QuizDefinition[];
}) {
	const readyForTallies =
		players.length > 0 &&
		players.every(player => isPlayerAtEndScreen(player, quizSet) || hasKickQuorum(player, players, quizSet, kickVotes));
	const rows = useMemo(() => groupScoreRows(players, quizSet), [players, quizSet]);

	return (
		<section className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border-2 border-neutral-950 bg-white p-3 shadow-[5px_5px_0_#171717]'>
			{readyForTallies ? (
				<GroupTallyTable players={players} rows={rows} />
			) : (
				<WaitingForPlayers
					currentPlayerName={currentPlayerName}
					kickVotes={kickVotes}
					onKick={onKick}
					players={players}
					quizSet={quizSet}
				/>
			)}
		</section>
	);
}

type Navigate = (path: string) => void;

type QuizPageProps = {
	quizSet?: readonly QuizDefinition[];
	skipIntro?: boolean;
};

export function QuizPage({ quizSet = quizzes, skipIntro = false }: QuizPageProps) {
	const initialPlayerNameRef = useRef<string | null>(null);
	if (initialPlayerNameRef.current === null) initialPlayerNameRef.current = readStoredPlayerName();
	const initialPlayerName = initialPlayerNameRef.current;
	const hasInitialPlayerName = initialPlayerName.length > 0;
	const { game, reloadGame, reloadPlayer, restartGame, sendAction } = useGameServer(!skipIntro);
	const loadedPlayerRef = useRef<string | null>(null);
	const gameStartedAtRef = useRef<string | null>(null);
	const [quizIndex, setQuizIndex] = useState(0);
	const [screenIndex, setScreenIndex] = useState(0);
	const [screenScores, setScreenScores] = useState<OptionPoints[]>([]);
	const [liveScreenScore, setLiveScreenScore] = useState<OptionPoints>(() => scoreInputToPoints({}));
	const [results, setResults] = useState<QuizResult[]>([]);
	const [playerName, setPlayerName] = useState(initialPlayerName);
	const [showGroupResults, setShowGroupResults] = useState(false);
	const [showPlayerName, setShowPlayerName] = useState(!skipIntro && !hasInitialPlayerName);
	const [soundState, setSoundState] = useState(() => {
		if (!skipIntro && !hasInitialPlayerName) return getInitialSoundState();

		return { stored: readStoredSoundChoice(), showIntro: false };
	});
	const [soundOn, setSoundOn] = useState(readStoredSoundOn);
	const [themeSongPlaying, setThemeSongPlaying] = useState(false);
	const [showVersusIntro, setShowVersusIntro] = useState(!skipIntro && !hasInitialPlayerName);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const versusAudioRef = useRef<HTMLAudioElement | null>(null);
	const themeSongPlayPendingRef = useRef(false);
	const versusSoundAttemptedRef = useRef(false);

	const finalPoints = sumOptionPoints(results.map(result => result.points));
	const isDone = results.length === quizSet.length;
	const currentQuiz = quizSet[quizIndex];
	const currentScreen = currentQuiz?.screens[screenIndex];
	const totalScreens = quizSet.reduce((total, quiz) => total + quiz.screens.length, 0);
	const completedScreens = results.reduce((total, result) => total + result.completedScreenCount, 0) + screenIndex;
	const progress = isDone || totalScreens === 0 ? 100 : Math.round((completedScreens / totalScreens) * 100);
	const activePoints = sumOptionPoints([...results.map(result => result.points), ...screenScores, liveScreenScore]);
	const previewScore = useCallback((score: Partial<OptionPoints>) => setLiveScreenScore(scoreInputToPoints(score)), []);
	const currentProgress = useMemo<PlayerProgress>(
		() => ({ quizIndex, results, screenIndex, screenScores }),
		[quizIndex, results, screenIndex, screenScores],
	);
	const localGroupPlayer = useMemo(() => {
		const syncedName = playerName.trim();
		const serverEndScreenAt = game?.players.find(player => player.name === syncedName)?.endScreenAt;
		const endScreenAt = isDone && showGroupResults ? (serverEndScreenAt ?? new Date().toISOString()) : undefined;

		return syncedName ? playerFromProgress(syncedName, currentProgress, endScreenAt) : null;
	}, [currentProgress, game?.players, isDone, playerName, showGroupResults]);
	const groupPlayers = useMemo(
		() => mergePlayers(game?.players ?? [], localGroupPlayer),
		[game?.players, localGroupPlayer],
	);
	const kickVotes = game?.kickVotes ?? emptyKickVotes;
	const groupReadyForTallies =
		groupPlayers.length > 0 &&
		groupPlayers.every(
			player => isPlayerAtEndScreen(player, quizSet) || hasKickQuorum(player, groupPlayers, quizSet, kickVotes),
		);
	const applyPlayerProgress = useCallback(
		(player: GamePlayer) => {
			setQuizIndex(player.quizIndex);
			setScreenIndex(player.screenIndex);
			setScreenScores(player.screenScores);
			setLiveScreenScore(scoreInputToPoints({}));
			setResults(player.results);
			setShowGroupResults(Boolean(player.endScreenAt && isPlayerDone(player, quizSet)));
			setShowPlayerName(false);
			setShowVersusIntro(false);
		},
		[quizSet],
	);
	const resetLocalGame = useCallback(() => {
		const syncedName = playerName.trim();

		loadedPlayerRef.current = null;
		setQuizIndex(0);
		setScreenIndex(0);
		setScreenScores([]);
		setLiveScreenScore(scoreInputToPoints({}));
		setResults([]);
		setShowGroupResults(false);
		setShowPlayerName(!skipIntro && !syncedName);
		setShowVersusIntro(!skipIntro && Boolean(syncedName));
	}, [playerName, skipIntro]);
	const savePlayerProgress = useCallback(
		(progress: PlayerProgress, name = playerName) => {
			const syncedName = name.trim();
			if (skipIntro || !syncedName) return;

			void sendAction({
				type: 'save',
				name: syncedName,
				progress,
				score: progressScore(progress),
			});
		},
		[playerName, sendAction, skipIntro],
	);
	const kickPlayer = useCallback(
		(targetName: string) => {
			const syncedName = playerName.trim();
			if (skipIntro || !syncedName) return;

			void sendAction({ type: 'kick', name: syncedName, targetName });
		},
		[playerName, sendAction, skipIntro],
	);
	const enterGroupResults = useCallback(() => {
		const syncedName = playerName.trim();

		setShowGroupResults(true);
		if (skipIntro || !syncedName) return;

		void sendAction({ type: 'ready', name: syncedName });
	}, [playerName, sendAction, skipIntro]);
	useEffect(() => {
		if (skipIntro) return;

		const previousRestartGame = window.DEBUG?.restartGame;
		const debugRestartGame = async () => {
			const nextGame = await restartGame();
			if (!nextGame) return null;

			resetLocalGame();

			const syncedName = playerName.trim();
			if (syncedName) void sendAction({ type: 'join', name: syncedName });

			return nextGame;
		};

		window.DEBUG = { ...window.DEBUG, restartGame: debugRestartGame };
		return () => {
			if (window.DEBUG?.restartGame !== debugRestartGame) return;
			if (previousRestartGame) {
				window.DEBUG = { ...window.DEBUG, restartGame: previousRestartGame };
				return;
			}

			const debug = window.DEBUG;
			if (!debug) return;

			delete debug.restartGame;
			if (Object.keys(debug).length === 0) delete window.DEBUG;
		};
	}, [playerName, resetLocalGame, restartGame, sendAction, skipIntro]);
	useEffect(() => {
		if (!game?.startedAt) return;

		const previousStartedAt = gameStartedAtRef.current;
		gameStartedAtRef.current = game.startedAt;
		if (!previousStartedAt || previousStartedAt === game.startedAt) return;

		resetLocalGame();

		const syncedName = playerName.trim();
		if (!skipIntro && syncedName) void sendAction({ type: 'join', name: syncedName });
	}, [game?.startedAt, playerName, resetLocalGame, sendAction, skipIntro]);
	useEffect(() => {
		const syncedName = playerName.trim();
		if (skipIntro || showPlayerName || !syncedName || loadedPlayerRef.current === syncedName) return;

		loadedPlayerRef.current = syncedName;
		void reloadPlayer(syncedName).then(player => {
			if (player) {
				if (hasSavedProgress(player)) {
					applyPlayerProgress(player);
					return;
				}

				setShowVersusIntro(true);
				return;
			}

			setShowVersusIntro(true);
			void sendAction({ type: 'join', name: syncedName });
		});
	}, [applyPlayerProgress, playerName, reloadPlayer, sendAction, showPlayerName, skipIntro]);

	useEffect(() => {
		if (skipIntro || !showGroupResults || groupReadyForTallies) return;

		void reloadGame();
		const interval = window.setInterval(() => void reloadGame(), 1000);
		return () => window.clearInterval(interval);
	}, [groupReadyForTallies, reloadGame, showGroupResults, skipIntro]);

	useEffect(() => {
		const audio = document.createElement('audio');
		const versusAudio = document.createElement('audio');

		audio.src = themeSongUrl;
		audio.loop = true;
		audio.preload = 'auto';
		audio.hidden = true;
		audio.setAttribute('aria-hidden', 'true');
		versusAudio.src = versusSoundUrl;
		versusAudio.preload = 'auto';
		versusAudio.hidden = true;
		versusAudio.setAttribute('aria-hidden', 'true');
		const markThemeSongPlaying = () => setThemeSongPlaying(true);
		const markThemeSongStopped = () => setThemeSongPlaying(false);
		audio.addEventListener('playing', markThemeSongPlaying);
		audio.addEventListener('pause', markThemeSongStopped);
		audio.addEventListener('ended', markThemeSongStopped);
		audioRef.current = audio;
		versusAudioRef.current = versusAudio;
		document.body.append(audio, versusAudio);
		audio.load();
		versusAudio.load();

		return () => {
			audio.removeEventListener('playing', markThemeSongPlaying);
			audio.removeEventListener('pause', markThemeSongStopped);
			audio.removeEventListener('ended', markThemeSongStopped);
			audio.pause();
			versusAudio.pause();
			audio.remove();
			versusAudio.remove();
			audioRef.current = null;
			versusAudioRef.current = null;
		};
	}, []);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		if (!soundOn) {
			audio.pause();
			return;
		}

		if (soundState.showIntro || showPlayerName || showVersusIntro || themeSongPlaying || !audio.paused) return;

		const retryThemeSong = () => {
			if (!audio.paused) return;
			void playThemeSong();
		};
		const retryInterval = window.setInterval(retryThemeSong, 1500);
		const retryOptions = { capture: true } as const;

		retryThemeSong();
		window.addEventListener('pointerdown', retryThemeSong, retryOptions);
		window.addEventListener('keydown', retryThemeSong, retryOptions);

		return () => {
			window.clearInterval(retryInterval);
			window.removeEventListener('pointerdown', retryThemeSong, retryOptions);
			window.removeEventListener('keydown', retryThemeSong, retryOptions);
		};
	}, [showPlayerName, showVersusIntro, soundOn, soundState.showIntro, themeSongPlaying]);

	function submit(rawScore: Partial<OptionPoints>, details?: readonly ScoreDetail[]) {
		if (!currentQuiz) return;

		const nextScores = [...screenScores, scoreInputToPoints(rawScore)];
		const detailScreens = details?.map(detail => ({
			title: detail.title,
			content: detail.content,
			points: scoreInputToPoints(detail.points),
		}));

		if (screenIndex < currentQuiz.screens.length - 1) {
			const nextProgress = {
				quizIndex,
				screenIndex: screenIndex + 1,
				screenScores: nextScores,
				results,
			};

			setScreenScores(nextScores);
			setLiveScreenScore(scoreInputToPoints({}));
			setScreenIndex(current => current + 1);
			savePlayerProgress(nextProgress);
			return;
		}

		const nextResult: QuizResult = {
			id: currentQuiz.id,
			title: currentQuiz.title,
			points: currentQuiz.score(nextScores),
			screens:
				detailScreens ??
				nextScores.map((points, index) => ({
					title: screenTitle(currentQuiz.screens[index], index),
					points,
				})),
			completedScreenCount: currentQuiz.screens.length,
		};

		const nextResults = [...results, nextResult];
		const nextProgress = {
			quizIndex: quizIndex + 1,
			screenIndex: 0,
			screenScores: [],
			results: nextResults,
		};

		setResults(nextResults);
		setScreenScores([]);
		setLiveScreenScore(scoreInputToPoints({}));
		setScreenIndex(0);
		setQuizIndex(current => current + 1);
		savePlayerProgress(nextProgress);
	}

	async function playThemeSong() {
		const audio = audioRef.current;
		if (!audio || themeSongPlayPendingRef.current) return false;

		try {
			themeSongPlayPendingRef.current = true;
			await audio.play();
			setThemeSongPlaying(true);
			return true;
		} catch {
			setThemeSongPlaying(false);
			return false;
		} finally {
			themeSongPlayPendingRef.current = false;
		}
	}

	function pauseThemeSong() {
		const audio = audioRef.current;
		if (!audio) return;

		audio.pause();
		setThemeSongPlaying(false);
	}

	function saveThemeSongIntent(on: boolean) {
		setSoundOn(on);
		writeStoredSoundOn(on);
	}

	async function playVersusIntroSound() {
		const audio = versusAudioRef.current;
		if (!audio) return false;

		versusSoundAttemptedRef.current = true;
		audio.currentTime = 0;
		audio.volume = 1;
		try {
			await audio.play();
			return true;
		} catch {
			return false;
		}
	}

	function chooseSound(choice: SoundChoice) {
		const stored = writeStoredSoundChoice(choice);
		setSoundState({ stored, showIntro: false });

		const nextSoundOn = choice === 'yes';

		if (!nextSoundOn) {
			saveThemeSongIntent(false);
			pauseThemeSong();
			return;
		}

		saveThemeSongIntent(true);
	}

	function submitPlayerName(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		const nextName = playerName.trim();
		if (!nextName) return;

		writeStoredPlayerName(nextName);
		loadedPlayerRef.current = nextName;
		setPlayerName(nextName);
		setShowPlayerName(false);
		void sendAction({ type: 'join', name: nextName }).then(player => {
			if (player && hasSavedProgress(player)) applyPlayerProgress(player);
		});
		if (hasFreshHeadphoneYes(soundState.stored)) void playVersusIntroSound();
	}

	function finishVersusIntro() {
		const stored = writeStoredSoundChoice('yes');

		setSoundState({ stored, showIntro: false });
		saveThemeSongIntent(true);
		void playThemeSong();
		setShowVersusIntro(false);
	}

	function toggleThemeSong() {
		if (themeSongPlaying) {
			saveThemeSongIntent(false);
			pauseThemeSong();
			return;
		}

		const stored = writeStoredSoundChoice('yes');
		setSoundState({ stored, showIntro: false });
		saveThemeSongIntent(true);
		void playThemeSong();
	}

	useEffect(() => {
		if (
			soundState.showIntro ||
			showPlayerName ||
			!showVersusIntro ||
			versusSoundAttemptedRef.current ||
			!hasFreshHeadphoneYes(soundState.stored)
		) {
			return;
		}

		void playVersusIntroSound().then(played => {
			if (played) return;
			setSoundState(current => (current.showIntro ? current : { ...current, showIntro: true }));
		});
	}, [showPlayerName, showVersusIntro, soundState.showIntro, soundState.stored]);

	function SoundButton() {
		return (
			<button
				aria-label={themeSongPlaying ? 'Turn theme song off' : 'Turn theme song on'}
				aria-pressed={themeSongPlaying}
				className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-neutral-950 bg-white text-neutral-950 shadow-[3px_3px_0_#171717] active:translate-x-px active:translate-y-px active:shadow-[1px_1px_0_#171717]'
				onClick={toggleThemeSong}
				type='button'
			>
				{themeSongPlaying ? <SpeakerHigh size={21} weight='fill' /> : <SpeakerSlash size={21} weight='fill' />}
			</button>
		);
	}

	if (soundState.showIntro) {
		return (
			<main className='relative isolate h-dvh overflow-hidden bg-neutral-950 text-neutral-950 sm:flex sm:items-center sm:justify-center sm:p-5'>
				<ClubBackground />
				<section className='relative z-10 mx-auto flex h-full w-full max-w-md flex-col justify-center p-4 text-center text-white sm:h-[760px] sm:max-h-full sm:p-0'>
					<div className='flex flex-col items-center justify-center gap-6'>
						<DiscoLogo />
						<div className='mx-auto flex h-24 w-24 items-center justify-center rounded-full border-2 border-neutral-950 bg-orange-300 shadow-[5px_5px_0_#171717]'>
							<Headphones size={54} weight='duotone' />
						</div>
						<p className='text-2xl font-black leading-tight'>Are your headphones connected?</p>

						<div className='grid w-full gap-3'>
							<Button onClick={() => chooseSound('yes')} theme='endAction'>
								yes
							</Button>
							<button
								className='min-h-12 rounded-lg border-2 border-neutral-950 bg-white px-4 py-3 text-base font-black text-neutral-950 shadow-[3px_3px_0_#171717] active:translate-x-px active:translate-y-px active:shadow-[1px_1px_0_#171717]'
								onClick={() => chooseSound('no')}
								type='button'
							>
								no I'm a boring person
							</button>
						</div>
					</div>
				</section>
			</main>
		);
	}

	if (showPlayerName) {
		const hasPlayerName = playerName.trim().length > 0;

		return (
			<main className='relative isolate h-dvh overflow-hidden bg-neutral-950 text-neutral-950 sm:flex sm:items-center sm:justify-center sm:p-5'>
				<ClubBackground />
				<section className='relative z-10 mx-auto flex h-full w-full max-w-md flex-col justify-center p-4 text-center text-white sm:h-[760px] sm:max-h-full sm:p-0'>
					<div className='flex flex-col items-center justify-center gap-6'>
						<DiscoLogo />
						<div className='mx-auto flex h-24 w-24 items-center justify-center rounded-full border-2 border-neutral-950 bg-cyan-200 shadow-[5px_5px_0_#171717]'>
							<UserCircle size={54} weight='duotone' />
						</div>
						<p className='text-2xl font-black leading-tight'>What's your player name?</p>

						<form
							autoComplete='off'
							className='grid w-full gap-4'
							data-1p-ignore='true'
							data-bwignore='true'
							data-form-type='other'
							data-lpignore='true'
							data-op-ignore='true'
							onSubmit={submitPlayerName}
						>
							<label className='grid gap-2 text-left'>
								<span className='text-xs font-black uppercase text-cyan-200'>player name</span>
								<input
									autoComplete='off'
									autoFocus
									className='h-14 rounded-lg border-2 border-neutral-950 bg-white px-4 text-xl font-black text-neutral-950 shadow-[4px_4px_0_#171717] outline-none placeholder:text-neutral-400 focus:ring-4 focus:ring-cyan-300/70'
									data-1p-ignore='true'
									data-bwignore='true'
									data-form-type='other'
									data-lpignore='true'
									data-op-ignore='true'
									maxLength={32}
									onChange={event => setPlayerName(event.target.value)}
									placeholder='Your name'
									value={playerName}
								/>
							</label>

							<Button disabled={!hasPlayerName} theme='endAction' type='submit'>
								next
							</Button>
						</form>
					</div>
				</section>
			</main>
		);
	}

	if (showVersusIntro) {
		return (
			<main className='relative isolate h-dvh overflow-hidden bg-neutral-950 text-neutral-950 sm:flex sm:items-center sm:justify-center sm:p-5'>
				<ClubBackground />
				<VersusIntro onReady={finishVersusIntro} />
			</main>
		);
	}

	return (
		<main className='relative isolate h-dvh overflow-hidden bg-neutral-950 text-neutral-950 sm:flex sm:items-center sm:justify-center sm:p-5'>
			<ClubBackground />
			{isDone && showGroupResults ? (
				<section className='relative z-10 mx-auto flex h-full w-full max-w-md flex-col gap-3 p-3 sm:h-[760px] sm:max-h-full sm:p-0'>
					<LogoHeader />
					<GroupResultsScreen
						currentPlayerName={playerName.trim()}
						kickVotes={kickVotes}
						onKick={kickPlayer}
						players={groupPlayers}
						quizSet={quizSet}
					/>
				</section>
			) : isDone ? (
				<section className='relative z-10 mx-auto flex h-full w-full max-w-md flex-col gap-3 p-3 sm:h-[760px] sm:max-h-full sm:p-0'>
					<LogoHeader />
					<section className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto rounded-lg border-2 border-neutral-950 bg-white p-4 shadow-[5px_5px_0_#171717]'>
						<div className='space-y-3'>
							<h2 className='text-2xl font-black leading-tight text-neutral-950'>
								{winningOption(finalPoints).name} is what you truly desire
							</h2>
							<PointsBreakdown points={finalPoints} />
						</div>

						<div className='space-y-3'>
							{results.map(result => (
								<div className='rounded-lg border border-neutral-200 bg-neutral-50 p-3' key={result.id}>
									<div className='grid grid-cols-[1fr_auto] items-center gap-3'>
										<h3 className='font-black'>{result.title}</h3>
										{result.screens.length === 1 ? <ScreenPointChips points={result.points} /> : null}
									</div>
									{result.screens.length > 1 ? (
										<QuestionScoreList className='mt-3 space-y-2' items={result.screens} />
									) : null}
								</div>
							))}
						</div>

						<Button className='mt-auto' onClick={enterGroupResults} theme='endAction'>
							but is this what everyone desires?
						</Button>
					</section>
					<StatusBar points={finalPoints} progress={progress} soundButton={<SoundButton />} />
				</section>
			) : currentQuiz && currentScreen ? (
				<section className='relative z-10 mx-auto flex h-full w-full max-w-md flex-col gap-3 overflow-visible p-3 sm:h-[760px] sm:max-h-full sm:p-0'>
					<LogoHeader />
					<div className='min-h-0 flex-1 overflow-visible'>
						<Suspense
							fallback={
								<div className='flex h-full items-center justify-center text-lg font-black text-white'>
									loading nonsense...
								</div>
							}
						>
							<currentQuiz.Screen
								config={currentScreen}
								key={`${currentQuiz.id}-${screenIndex}`}
								previewScore={previewScore}
								screenCount={currentQuiz.screens.length}
								screenNumber={screenIndex + 1}
								submit={submit}
							/>
						</Suspense>
					</div>
					<StatusBar points={activePoints} progress={progress} soundButton={<SoundButton />} />
				</section>
			) : null}
		</main>
	);
}

export function QuizTestIndex({ navigate }: { navigate: Navigate }) {
	return (
		<main className='relative isolate h-dvh overflow-hidden bg-neutral-950 text-neutral-950 sm:flex sm:items-center sm:justify-center sm:p-5'>
			<ClubBackground />
			<section className='relative z-10 mx-auto flex h-full w-full max-w-md flex-col justify-center gap-5 p-4 text-white sm:h-[760px] sm:max-h-full sm:p-0'>
				<div className='space-y-2'>
					<p className='text-xs font-bold uppercase text-cyan-200'>test mode</p>
					<h1 className='text-4xl font-black leading-none'>Pick a quiz</h1>
				</div>

				<div className='grid gap-3'>
					{quizzes.map(quiz => (
						<button
							className='rounded-lg border-2 border-neutral-950 bg-white p-4 text-left text-neutral-950 shadow-[5px_5px_0_#171717] active:translate-x-px active:translate-y-px active:shadow-[2px_2px_0_#171717]'
							key={quiz.id}
							onClick={() => navigate(`/test/${quiz.id}`)}
							type='button'
						>
							<span className='block text-lg font-black'>{quiz.title}</span>
							<span className='mt-1 block text-sm font-bold text-neutral-500'>
								{quiz.screens.length} {quiz.screens.length === 1 ? 'screen' : 'screens'}
							</span>
						</button>
					))}
				</div>

				<button
					className='min-h-12 rounded-lg border-2 border-white/80 bg-transparent px-4 py-3 text-base font-black text-white active:translate-y-px'
					onClick={() => navigate('/')}
					type='button'
				>
					Back to the real thing
				</button>
			</section>
		</main>
	);
}

export function QuizTestPage({ navigate, quizId }: { navigate: Navigate; quizId: string }) {
	const quiz = quizzes.find(candidate => candidate.id === quizId);

	if (!quiz) {
		return (
			<main className='relative isolate h-dvh overflow-hidden bg-neutral-950 text-neutral-950 sm:flex sm:items-center sm:justify-center sm:p-5'>
				<ClubBackground />
				<section className='relative z-10 mx-auto flex h-full w-full max-w-md flex-col justify-center gap-4 p-4 text-white sm:h-[760px] sm:max-h-full sm:p-0'>
					<p className='text-xs font-bold uppercase text-rose-200'>missing quiz</p>
					<h1 className='text-4xl font-black leading-none'>No such nonsense</h1>
					<button
						className='min-h-12 rounded-lg bg-white px-4 py-3 text-base font-black text-neutral-950 active:translate-y-px'
						onClick={() => navigate('/test')}
						type='button'
					>
						Back to test mode
					</button>
				</section>
			</main>
		);
	}

	return <QuizPage key={quiz.id} quizSet={[quiz]} skipIntro />;
}
