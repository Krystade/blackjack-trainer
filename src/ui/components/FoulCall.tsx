import type { Game } from '../../engine/game';
import { ResultStrip } from './ResultStrip';
import { foulVerdictText, missedErrorText } from '../dealerErrorCopy';
import './foulCall.css';

/**
 * G2 (L-8): Play's Foul call, and what came of it.
 *
 * The button shows from settlement until the next deal, while the dealer can
 * be making mistakes (or this round carries one), and once per round. The
 * verdict replaces it; an error left uncalled is said on the next round, as
 * a miss, until the deal after that.
 *
 * Inside the message strip, which skips bot pacing on a tap: the button
 * stops its click there, so calling Foul never also fast-forwards the table.
 */
/** `unit`: Track 3 Show chips -- the payout error named in dollars. */
export function FoulCall({ game, onFoul, unit }: { game: Game; onFoul: () => void; unit?: number }) {
  const offered = game.foulOpen && !game.countCheckOpen && (game.dealerMistakes || game.dealerError !== null);
  const verdict = game.phase === 'settled' ? game.foulVerdict : null;
  const missed = game.missedDealerError;
  if (!offered && !verdict && !missed) return null;
  return (
    <div className="foul-call" data-testid="foul-call">
      {missed && (
        <ResultStrip id={`foul-missed-${game.roundNo}`} tone="miss">
          <span className="foul-missed" data-testid="foul-missed" data-kind={missed.kind}>
            {missedErrorText(missed, unit)}
          </span>
        </ResultStrip>
      )}
      {verdict && (
        <ResultStrip id={`foul-${game.roundNo}`} tone={verdict.correct ? 'ok' : 'miss'}>
          <span
            className="foul-verdict"
            data-testid="foul-verdict"
            data-correct={verdict.correct ? 'true' : 'false'}
            data-kind={verdict.error?.kind}
          >
            {foulVerdictText(verdict, unit)}
          </span>
        </ResultStrip>
      )}
      {offered && (
        <button
          type="button"
          className="u-btn foul-btn"
          aria-describedby="foul-hint"
          onClick={(e) => {
            e.stopPropagation();
            onFoul();
          }}
        >
          Foul
        </button>
      )}
      {offered && (
        <span id="foul-hint" className="foul-hint">
          Wrong payout? Call it before the next deal.
        </span>
      )}
    </div>
  );
}
