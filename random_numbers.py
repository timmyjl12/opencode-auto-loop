import random

def print_random_numbers(count=10, min_val=1, max_val=100):
    for _ in range(count):
        print(random.randint(min_val, max_val))

if __name__ == "__main__":
    print_random_numbers()
