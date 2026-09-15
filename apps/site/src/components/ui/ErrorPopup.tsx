import { Modal } from "./Modal.js";
import { Button } from "./Button.js";

// A closable pop-up for surfacing a failed action (insufficient funds, a cap already hit,
// a validation rejection) — inline banner text is easy to miss, especially when the
// triggering control lives inside another modal/panel already on screen.
export function ErrorPopup({ message, onClose, title = "Something went wrong" }: { message: string; onClose: () => void; title?: string }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <Button variant="primary" onClick={onClose}>Got it</Button>
    </Modal>
  );
}
