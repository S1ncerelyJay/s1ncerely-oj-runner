#include <bits/stdc++.h>

int main() {
  std::vector<int> values{4, 1, 3, 2};
  std::sort(values.begin(), values.end());
  const int sum = std::accumulate(values.begin(), values.end(), 0);
  return values == std::vector<int>({1, 2, 3, 4}) && sum == 10 ? 0 : 1;
}
