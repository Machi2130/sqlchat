require('dotenv').config();
const express = require('express');
const { Groq } = require('groq-sdk');
const mysql = require('mysql2/promise');
const cors = require('cors');
const winston = require('winston');

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'sql_chat.log' }),
    new winston.transports.Console()
  ]
});

// Log the GROQ_API_KEY for debugging
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY);

// Temporary direct instantiation of the Groq client with the API key
const apiKey = process.env.GROQ_API_KEY || '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';
const llmClient = new Groq({ apiKey });

class DatabaseConfig {
  constructor(host, user, password, port = 3306) {
    this.host = host;
    this.user = user;
    this.password = password;
    this.port = port;
  }

  getConnectionConfig(database = null) {
    return {
      host: this.host,
      user: this.user,
      password: this.password,
      port: this.port,
      database: database
    };
  }
}

class DatabaseManager {
  constructor(config) {
    this.config = config;
    this.pools = new Map();
    this.testConnection();
  }

  async testConnection() {
    try {
      const connection = await mysql.createConnection(this.config.getConnectionConfig());
      await connection.execute('SELECT 1');
      console.log('\n===================');
      console.log('✅ Database Connection Status');
      console.log('Status: Connected successfully');
      console.log(`Host: ${this.config.host}`);
      console.log(`User: ${this.config.user}`);
      console.log('===================\n');
      await connection.end();
    } catch (err) {
      logger.error(`Database connection failed: ${err.message}`);
      throw err;
    }
  }

  async getSchemaInfo(database) {
    const connection = await mysql.createConnection(this.config.getConnectionConfig(database));
    const [tables] = await connection.query('SHOW TABLES');
    const schema = {};
    
    for (const table of tables) {
      const tableName = Object.values(table)[0];
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${tableName}`);
      schema[tableName] = columns.map(col => col.Field);
    }
    
    await connection.end();
    return schema;
  }

  async executeQuery(database, query) {
    const connection = await mysql.createConnection(this.config.getConnectionConfig(database));
    const [results] = await connection.query(query);
    await connection.end();
    return results;
  }
}

class QueryProcessor {
  constructor(llmClient, dbManager) {
    this.llmClient = llmClient;
    this.dbManager = dbManager;
    this.queryHistory = [];
  }

  async generateSql(naturalQuery, schemaInfo) {
    const schemaDescription = Object.entries(schemaInfo)
      .map(([table, columns]) => `Table '${table}' with columns: ${columns.join(', ')}`)
      .join('. ');

    const completion = await this.llmClient.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{
        role: "user",
        content: `Convert to SQL query. Return only the SQL query without any markdown or comments. Schema: ${schemaDescription}. Query: ${naturalQuery}`
      }],
      temperature: 0.5,
      max_tokens: 512
    });

    return this.cleanSql(completion.choices[0].message.content);
  }

  cleanSql(sql) {
    return sql.replace(/```sql|```/g, '').trim().replace(/\s+/g, ' ').replace(/;$/, '');
  }

  async executeQuery(naturalQuery, database) {
    const startTime = Date.now();
    try {
      const schemaInfo = await this.dbManager.getSchemaInfo(database);
      const sqlQuery = await this.generateSql(naturalQuery, schemaInfo);
      
      console.log('\n===================');
      console.log('Generated SQL Query:');
      console.log(sqlQuery);
      console.log('===================\n');
      
      const results = await this.dbManager.executeQuery(database, sqlQuery);
      const executionTime = (Date.now() - startTime) / 1000;
      
      this.logQuery(naturalQuery, sqlQuery, database, executionTime);
      
      return {
        query: sqlQuery,
        results: results,
        execution_time: executionTime,
        success: true
      };
    } catch (error) {
      logger.error(`Query execution error: ${error.message}`);
      return {
        query: '',
        results: [],
        execution_time: (Date.now() - startTime) / 1000,
        success: false,
        error: error.message
      };
    }
  }

  logQuery(naturalQuery, sql, database, executionTime) {
    this.queryHistory.push({
      natural_query: naturalQuery,
      sql: sql,
      database: database,
      execution_time: executionTime,
      timestamp: new Date()
    });
  }
}

class SQLChatAPI {
  constructor(dbConfig) {
    this.app = express();
    this.dbManager = new DatabaseManager(dbConfig);
    this.llmClient = llmClient; // Use the temporary direct instantiation
    this.processor = new QueryProcessor(this.llmClient, this.dbManager);
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  setupRoutes() {
    this.app.get('/databases', async (req, res) => {
      try {
        const connection = await mysql.createConnection(this.dbManager.config.getConnectionConfig());
        const [results] = await connection.query('SHOW DATABASES');
        await connection.end();
        res.json({ databases: results.map(row => row.Database) });
      } catch (error) {
        logger.error(`Database fetch error: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/columns', async (req, res) => {
      const database = req.query.database;
      if (!database) {
        return res.status(400).json({ error: 'Database name required' });
      }
      
      try {
        const schema = await this.dbManager.getSchemaInfo(database);
        res.json({ columns: schema });
      } catch (error) {
        logger.error(`Column fetch error: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/query', async (req, res) => {
      const { query, database } = req.body;
      
      if (!database) {
        return res.status(400).json({ error: 'Database selection required' });
      }
      
      const result = await this.processor.executeQuery(query, database);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json({
          error: result.error,
          query: query,
          database: database
        });
      }
    });
  }

  start(port = 5001) {
    this.app.listen(port, () => {
      console.log('\n===================');
      console.log('🚀 Starting SQL Chat API');
      console.log(`Server running on: http://localhost:${port}`);
      console.log('===================\n');
    });
  }
}

const dbConfig = new DatabaseConfig(
  'localhost',
  'root',
  '#Prathamesh@5500'
);

const api = new SQLChatAPI(dbConfig);
api.start();
