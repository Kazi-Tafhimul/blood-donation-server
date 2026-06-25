const dns = require('node:dns/promises');
dns.setServers(["1.1.1.1", "8.8.8.8"])
const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;

require('dotenv').config()
app.use(cors());
app.use(express.json());
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
app.get('/', (req,res)=>{
    res.send("hello world");

})



const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("bloodlink_new")
    const requestCollection = database.collection("requests");
    app.post('/api/requests', async(req,res)=>{
      const request = req.body;
      const result = await requestCollection.insertOne(request);
      res.send(result);

    })
  app.get("/api/requests", async (req, res) => {
  try {
    const { email, status } = req.query;
    let matchQuery = {};

    if (email) {
      matchQuery.requesterEmail = email;
    }
    
    // Advanced status matching
    if (status && status !== "all") {
      if (status === "pending") {
        // Matches if status is exactly "Pending", "pending", OR if the status field does not exist/is null
        matchQuery.$or = [
          { status: { $regex: "^pending$", $options: "i" } },
          { status: { $exists: false } },
          { status: null }
        ];
      } else if (status === "inprogress") {
        matchQuery.status = { $regex: "^in\\s*progress$", $options: "i" };
      } else {
        matchQuery.status = { $regex: `^${status}$`, $options: "i" };
      }
    }

    const requests = await requestCollection
      .find(matchQuery)
      .toArray();

    res.status(200).json(requests);
  } catch (error) {
    console.error("Fetch error details:", error);
    res.status(500).json([]);
  }
});
app.delete("/api/requests/:id", async (req, res) => {
  try {
    const id = req.params.id;
    
   
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid Request ID format" });
    }

    const query = { _id: new ObjectId(id) };
    const result = await requestCollection.deleteOne(query);

    if (result.deletedCount === 1) {
      res.status(200).json({ success: true, message: "Deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Request not found" });
    }
  } catch (error) {
    console.error("Delete error details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.listen(port, ()=>{
    console.log("app listening on port ${port}");
})