/**
 * SQL Chat Bot API Layer
 * Express server handling frontend-backend communication
 */

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { performance } = require('perf_hooks');

class QueryAnalytics {
    constructor() {
        this.queries = new Map();
        this.totalQueries = 0;
        this.totalErrors = 0;
    }

    trackQuery(query, duration, success = true) {
        const stats = this.queries.get(query) || { 
            count: 0, 
            totalTime: 0,
            successCount: 0,
            errorCount: 0
        };
        
        stats.count++;
        stats.totalTime += duration;
        success ? stats.successCount++ : stats.errorCount++;
        
        this.queries.set(query, stats);
        this.totalQueries++;
        if (!success) this.totalErrors++;
    }

    getAnalytics() {
        const analytics = Array.from(this.queries.entries()).map(([query, stats]) => ({
            query,
            avgTime: stats.totalTime / stats.count,
            count: stats.count,
            successRate: (stats.successCount / stats.count) * 100
        }));

        return {
            queries: analytics,
            totalQueries: this.totalQueries,
            errorRate: (this.totalErrors / this.totalQueries) * 100,
            successRate: ((this.totalQueries - this.totalErrors) / this.totalQueries) * 100
        };
    }
}

class APIServer {
    constructor() {
        this.app = express();
        this.analytics = new QueryAnalytics();
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(cors({
            origin: 'http://localhost:3000',
            methods: ['GET', 'POST'],
            allowedHeaders: ['Content-Type']
        }));
        this.app.use(express.json());
    }

    setupRoutes() {
        this.app.get('/health', this.handleHealth.bind(this));
        this.app.get('/api/databases', this.handleDatabases.bind(this));
        this.app.get('/api/columns', this.handleColumns.bind(this));
        this.app.post('/api/query', this.handleQuery.bind(this));
    }

    async handleHealth(req, res) {
        res.json({ 
            status: 'ok', 
            analytics: this.analytics.getAnalytics() 
        });
    }

    async handleDatabases(req, res) {
        try {
            const response = await axios.get('http://127.0.0.1:5001/databases');
            res.json(response.data);
        } catch (error) {
            console.error('Database fetch error:', error.message);
            res.status(500).json({ error: 'Failed to fetch databases' });
        }
    }

    async handleColumns(req, res) {
        try {
            const database = req.query.database;
            const response = await axios.get(
                `http://127.0.0.1:5001/columns?database=${database}`
            );
            res.json(response.data);
        } catch (error) {
            console.error('Column fetch error:', error.message);
            res.status(500).json({ error: 'Failed to fetch columns' });
        }
    }

    async handleQuery(req, res) {
        const startTime = performance.now();
        try {
            const response = await axios.post('http://127.0.0.1:5001/query', req.body, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' }
            });
            
            const duration = performance.now() - startTime;
            this.analytics.trackQuery(req.body.query, duration, true);
            
            console.log('\nQuery Execution Details:');
            console.log('Original Query:', req.body.query);
            console.log('Generated SQL:', response.data.query);
            console.log('Execution Time:', duration.toFixed(2), 'ms\n');
            
            res.json({
                ...response.data,
                serverMetrics: this.analytics.getAnalytics()
            });
        } catch (error) {
            const duration = performance.now() - startTime;
            this.analytics.trackQuery(req.body.query, duration, false);
            
            console.error('Query Execution Error:', error.response?.data || error.message);
            res.status(500).json({
                error: 'Query processing failed',
                details: error.response?.data || error.message,
                analytics: this.analytics.getAnalytics()
            });
        }
    }

    start(port = 3002) {
        this.app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}`);
        });
    }
}

// Start server
const server = new APIServer();
server.start();

// In server.js
const DB_CONFIG = {
    host: 'localhost',
    user: 'root',
    password: '#Prathamesh@5500'  
};
