import logging
import time

from .store import initialize, tick


def main():
    initialize()
    while True:
        try:
            tick()
        except Exception:
            logging.getLogger(__name__).exception("Scheduled check transaction failed; retrying")
        time.sleep(1)


if __name__ == "__main__":
    main()
