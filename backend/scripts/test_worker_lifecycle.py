from concurrent.futures import ProcessPoolExecutor
import time
import os
import psutil


def dummy_task():
    print(f"Worker {os.getpid()} executing...")
    time.sleep(1)
    return os.getpid()


if __name__ == "__main__":
    pool = ProcessPoolExecutor(max_workers=2)
    print("Pool created.")

    # Submit tasks
    f1 = pool.submit(dummy_task)
    f2 = pool.submit(dummy_task)

    print(f"Task 1 ran on worker {f1.result()}")
    print(f"Task 2 ran on worker {f2.result()}")

    print("\nTasks done. Waiting 5 seconds to observe worker state...")
    time.sleep(5)

    # Check if workers are still alive
    children = psutil.Process().children()
    print(f"\nActive workers: {len(children)}")
    for child in children:
        print(f"  Worker PID: {child.pid} - Status: {child.status()}")

    print("\nShutting down pool...")
    pool.shutdown(wait=True)

    children = psutil.Process().children()
    print(f"Active workers after shutdown: {len(children)}")
