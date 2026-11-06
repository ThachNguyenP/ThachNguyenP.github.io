---
layout: post
title: "044.Promise and Async/Await."
author: thach
categories: [Coding]
tags: [Node]
image: assets/images/post_044/async-await.png
---
JavaScript là một ngôn ngữ lập trình bất đồng bộ (asynchronous), điều này có nghĩa là code không nhất thiết phải chạy tuần tự từ trên xuống dưới. Trong bài viết này, chúng ta sẽ tìm hiểu về 3 cách xử lý bất đồng bộ trong JavaScript: Callback, Promise, và Async/Await.

#### 1. Callback - Cách truyền thống

Callback là một function được truyền như một argument vào một function khác, và được gọi lại (called back) sau khi một tác vụ nào đó hoàn thành.

##### Ví dụ cơ bản về Callback

```javascript
function fetchUserData(userId, callback) {
  setTimeout(() => {
    const user = { id: userId, name: 'John Doe', email: 'john@example.com' };
    callback(user);
  }, 1000);
}

fetchUserData(1, (user) => {
  console.log('User data:', user);
});
```

##### Callback Hell (Pyramid of Doom)

Vấn đề lớn nhất của callback là khi chúng ta cần thực hiện nhiều tác vụ bất đồng bộ phụ thuộc lẫn nhau, code sẽ trở nên khó đọc và khó maintain:

```javascript
fetchUserData(1, (user) => {
  fetchUserPosts(user.id, (posts) => {
    fetchPostComments(posts[0].id, (comments) => {
      fetchCommentAuthor(comments[0].authorId, (author) => {
        console.log('Author:', author);
        // Callback hell! Code becomes difficult to read and maintain
      });
    });
  });
});
```

##### Error Handling với Callback

```javascript
function fetchData(url, callback) {
  setTimeout(() => {
    const error = Math.random() > 0.5 ? null : new Error('Failed to fetch');
    const data = error ? null : { id: 1, name: 'Sample Data' };
    callback(error, data);
  }, 1000);
}

fetchData('api/users', (error, data) => {
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  console.log('Data:', data);
});
```

#### 2. Promise - Giải pháp cho Callback Hell

Promise là một object đại diện cho việc hoàn thành (hoặc thất bại) của một tác vụ bất đồng bộ trong tương lai. Promise có 3 trạng thái:
- **Pending**: Trạng thái khởi tạo, chưa hoàn thành hoặc thất bại
- **Fulfilled**: Tác vụ hoàn thành thành công
- **Rejected**: Tác vụ thất bại

##### Tạo một Promise

```javascript
function fetchUserData(userId) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (userId > 0) {
        const user = { id: userId, name: 'John Doe', email: 'john@example.com' };
        resolve(user);
      } else {
        reject(new Error('Invalid user ID'));
      }
    }, 1000);
  });
}
```

##### Sử dụng Promise với then/catch

```javascript
fetchUserData(1)
  .then((user) => {
    console.log('User:', user);
    return fetchUserPosts(user.id);
  })
  .then((posts) => {
    console.log('Posts:', posts);
    return fetchPostComments(posts[0].id);
  })
  .then((comments) => {
    console.log('Comments:', comments);
  })
  .catch((error) => {
    console.error('Error:', error.message);
  })
  .finally(() => {
    console.log('Operation completed');
  });
```

##### Promise.all() - Chạy nhiều Promise song song

```javascript
const promise1 = fetchUserData(1);
const promise2 = fetchUserData(2);
const promise3 = fetchUserData(3);

Promise.all([promise1, promise2, promise3])
  .then((users) => {
    console.log('All users:', users);
  })
  .catch((error) => {
    console.error('At least one promise failed:', error);
  });
```

##### Promise.race() - Lấy kết quả Promise nhanh nhất

```javascript
const slowPromise = new Promise((resolve) => setTimeout(() => resolve('Slow'), 3000));
const fastPromise = new Promise((resolve) => setTimeout(() => resolve('Fast'), 1000));

Promise.race([slowPromise, fastPromise])
  .then((result) => {
    console.log('Winner:', result); // Output: "Winner: Fast"
  });
```

##### Promise.allSettled() - Chờ tất cả Promise hoàn thành

```javascript
const promises = [
  Promise.resolve('Success 1'),
  Promise.reject('Error 1'),
  Promise.resolve('Success 2')
];

Promise.allSettled(promises)
  .then((results) => {
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        console.log('Fulfilled:', result.value);
      } else {
        console.log('Rejected:', result.reason);
      }
    });
  });
```

#### 3. Async/Await - Cú pháp hiện đại

Async/Await là cú pháp được giới thiệu trong ES2017 (ES8), giúp code bất đồng bộ trông giống như code đồng bộ, dễ đọc và dễ hiểu hơn.

##### Cú pháp cơ bản

```javascript
async function getUserData(userId) {
  try {
    const user = await fetchUserData(userId);
    console.log('User:', user);

    const posts = await fetchUserPosts(user.id);
    console.log('Posts:', posts);

    const comments = await fetchPostComments(posts[0].id);
    console.log('Comments:', comments);

    return comments;
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  }
}

getUserData(1);
```

##### Async/Await với Arrow Function

```javascript
const fetchData = async () => {
  const response = await fetch('https://api.example.com/data');
  const data = await response.json();
  return data;
};

fetchData()
  .then(data => console.log(data))
  .catch(error => console.error(error));
```

##### Chạy nhiều Async operations song song

```javascript
async function fetchMultipleUsers() {
  try {
    // Sai cách - chạy tuần tự, mất nhiều thời gian
    const user1 = await fetchUserData(1);
    const user2 = await fetchUserData(2);
    const user3 = await fetchUserData(3);

    // Đúng cách - chạy song song, tiết kiệm thời gian
    const [userA, userB, userC] = await Promise.all([
      fetchUserData(1),
      fetchUserData(2),
      fetchUserData(3)
    ]);

    return [userA, userB, userC];
  } catch (error) {
    console.error('Error fetching users:', error);
  }
}
```

##### Error Handling với Async/Await

```javascript
async function handleAsyncOperation() {
  try {
    const data = await fetchData();
    const processed = await processData(data);
    return processed;
  } catch (error) {
    // Handle errors from any await operation
    console.error('Operation failed:', error.message);
    throw error; // Re-throw if needed
  } finally {
    // Always executes, useful for cleanup
    console.log('Cleanup operations');
  }
}
```

##### Async/Await trong vòng lặp

```javascript
// Sequential execution - chạy tuần tự
async function processUsersSequential(userIds) {
  const results = [];
  for (const userId of userIds) {
    const user = await fetchUserData(userId);
    results.push(user);
  }
  return results;
}

// Parallel execution - chạy song song (nhanh hơn)
async function processUsersParallel(userIds) {
  const promises = userIds.map(userId => fetchUserData(userId));
  const results = await Promise.all(promises);
  return results;
}
```

#### 4. So sánh Callback vs Promise vs Async/Await

##### Cùng một tác vụ với 3 cách khác nhau:

**Callback:**
```javascript
function getData(callback) {
  fetchUser(1, (user) => {
    fetchPosts(user.id, (posts) => {
      fetchComments(posts[0].id, (comments) => {
        callback(comments);
      });
    });
  });
}
```

**Promise:**
```javascript
function getData() {
  return fetchUser(1)
    .then(user => fetchPosts(user.id))
    .then(posts => fetchComments(posts[0].id))
    .then(comments => comments);
}
```

**Async/Await:**
```javascript
async function getData() {
  const user = await fetchUser(1);
  const posts = await fetchPosts(user.id);
  const comments = await fetchComments(posts[0].id);
  return comments;
}
```

#### 5. Best Practices

##### 1. Luôn xử lý errors
```javascript
// Good
async function goodPractice() {
  try {
    const data = await fetchData();
    return data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Bad - unhandled promise rejection
async function badPractice() {
  const data = await fetchData(); // No error handling!
  return data;
}
```

##### 2. Tránh await không cần thiết
```javascript
// Bad - unnecessary await
async function badExample() {
  return await fetchData();
}

// Good - return promise directly
async function goodExample() {
  return fetchData();
}

// Except when you need try/catch
async function withErrorHandling() {
  try {
    return await fetchData(); // await needed here for try/catch
  } catch (error) {
    console.error(error);
  }
}
```

##### 3. Sử dụng Promise.all() cho parallel operations
```javascript
// Bad - sequential (slow)
async function sequential() {
  const user = await fetchUser();
  const posts = await fetchPosts();
  const comments = await fetchComments();
  return { user, posts, comments };
}

// Good - parallel (fast)
async function parallel() {
  const [user, posts, comments] = await Promise.all([
    fetchUser(),
    fetchPosts(),
    fetchComments()
  ]);
  return { user, posts, comments };
}
```

##### 4. Sử dụng async/await với forEach (cẩn thận!)
```javascript
// Bad - forEach doesn't work with async/await
async function badForEach(items) {
  items.forEach(async (item) => {
    await processItem(item); // This won't wait!
  });
}

// Good - use for...of or map with Promise.all
async function goodForOf(items) {
  for (const item of items) {
    await processItem(item); // Sequential
  }
}

async function goodParallel(items) {
  await Promise.all(items.map(item => processItem(item))); // Parallel
}
```

#### 6. Real-world Examples

##### Example 1: Fetch API với Async/Await
```javascript
async function fetchUserProfile(userId) {
  try {
    const response = await fetch(`https://api.example.com/users/${userId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const user = await response.json();
    return user;
  } catch (error) {
    console.error('Failed to fetch user profile:', error);
    throw error;
  }
}

// Usage
fetchUserProfile(123)
  .then(user => console.log('User:', user))
  .catch(error => console.error('Error:', error));
```

##### Example 2: Retry Logic với Async/Await
```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retry ${i + 1}/${maxRetries}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

##### Example 3: Timeout với Promise.race()
```javascript
function timeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout')), ms);
  });
}

async function fetchWithTimeout(url, timeoutMs = 5000) {
  try {
    const response = await Promise.race([
      fetch(url),
      timeout(timeoutMs)
    ]);
    return await response.json();
  } catch (error) {
    if (error.message === 'Timeout') {
      console.error('Request timed out');
    }
    throw error;
  }
}
```

##### Example 4: Batch Processing
```javascript
async function batchProcess(items, batchSize = 5) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => processItem(item))
    );
    results.push(...batchResults);

    // Optional: delay between batches
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}
```

#### Kết luận

- **Callback**: Cách cũ nhất, dẫn đến callback hell, khó maintain
- **Promise**: Giải quyết callback hell, dễ đọc hơn với chaining
- **Async/Await**: Cú pháp hiện đại nhất, code trông giống synchronous, dễ đọc và dễ hiểu nhất

Trong các dự án mới, nên ưu tiên sử dụng **Async/Await** vì:
- Code dễ đọc và dễ maintain hơn
- Error handling rõ ràng với try/catch
- Debug dễ dàng hơn
- Được hỗ trợ rộng rãi trong các trình duyệt hiện đại

Tuy nhiên, vẫn cần hiểu về Promise vì Async/Await thực chất là syntactic sugar built on top of Promises.
