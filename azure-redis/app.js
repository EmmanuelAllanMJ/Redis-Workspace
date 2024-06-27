const express = require('express');
const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 3001;

// Environment variables for cache
const cacheHostName = process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME;
const cachePassword = process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY;

if (!cacheHostName) throw Error("AZURE_CACHE_FOR_REDIS_HOST_NAME is empty");
if (!cachePassword) throw Error("AZURE_CACHE_FOR_REDIS_ACCESS_KEY is empty");

// Create Redis client
const cacheConnection = redis.createClient({
    url: `rediss://${cacheHostName}:6380`,
    password: cachePassword
});

// Connect to Redis
cacheConnection.connect().catch(console.error);

// Function to fetch posts from JSONPlaceholder
async function fetchPostsFromAPI() {
    const response = await fetch('https://jsonplaceholder.typicode.com/posts');
    return response.json();
}

// Middleware for caching
async function cache(req, res, next) {
    const { id } = req.params;
    const cacheKey = `post:${id}`;

    try {
        const cachedPost = await cacheConnection.get(cacheKey);
        if (cachedPost) {
            console.log('Data retrieved from cache');
            res.json(JSON.parse(cachedPost));
        } else {
            next();
        }
    } catch (error) {
        console.error('Cache error:', error);
        next();
    }
}

// Route to get all posts
app.get('/posts', async (req, res) => {
    const cacheKey = 'all_posts';

    try {
        const cachedPosts = await cacheConnection.get(cacheKey);
        if (cachedPosts) {
            console.log('All posts retrieved from cache');
            res.json(JSON.parse(cachedPosts));
        } else {
            console.log('Fetching all posts from API');
            const posts = await fetchPostsFromAPI();
            await cacheConnection.set(cacheKey, JSON.stringify(posts), { EX: 3600 });
            res.json(posts);
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred' });
    }
});

// Route to get a single post
app.get('/posts/:id', cache, async (req, res) => {
    const { id } = req.params;
    const cacheKey = `post:${id}`;

    try {
        console.log('Fetching post from API');
        const response = await fetch(`https://jsonplaceholder.typicode.com/posts/${id}`);
        const post = await response.json();

        await cacheConnection.set(cacheKey, JSON.stringify(post), { EX: 3600 });
        res.json(post);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred' });
    }
});

// Route to clear cache
app.get('/clear-cache', async (req, res) => {
    try {
        await cacheConnection.flushAll();
        res.json({ message: 'Cache cleared' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});