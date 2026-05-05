require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 3000;

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
//TODO: __________________JWT VERIFICATION MIDDLEWARE _______________
const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  //* VERIFY TOKEN
  jwt.verify(token, process.env.jwt_secret, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    console.log("decoded", decoded);
    req.user = decoded;
    next();
  });
};

// MongoDB connection URI
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASSWORD}@cluster0.dgbpvrt.mongodb.net/?appName=Cluster0`;

// Create a MongoClient
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  // *** : _______________ DATABASE CONNECTION___________________
  const db = client.db("ReadTogether");
  const userCollection = db.collection("users");
  const bookCollection = db.collection("books");
  const orderCollection = db.collection("orders");
  const wishlistCollection = db.collection("wishlist");
  try {
    await client.connect();

    // TODO : ______________ JWT ROUTE __________________________
    app.post("/jwt", (req, res) => {
      const { email } = req.body;
      // console.log("JWT route hit with email:", email);
      const token = jwt.sign({ email }, process.env.jwt_secret, {
        expiresIn: "7d",
      });
      // SET COOKIE ||||||||||||||||||||
      res.cookie("token", token, {
        httpOnly: true,
        secure: false,
      });
      res.send({ token });
    });

    // TODO : _______________ USERS COLLECTION___________________
    // USER GET ALL------->
    app.get("/users", async (req, res) => {
      const result = await userCollection.find({}).toArray();
      res.send(result);
    });
    // USER POST---------->
    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const existingUser = await userCollection.findOne({ email });
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }
      const result = await userCollection.insertOne(req.body);
      res.send(result);
    });

    // TODO : _______________ BOOKS COLLECTION___________________
    // GET THE BOOKS---->
    app.get("/books", async (req, res) => {
      const limit = parseInt(req.query.limit);
      // console.log("limit", limit);
      const result = await bookCollection
        .find({})
        .limit(limit)
        .sort({ _id: -1 })
        .toArray();
      res.send(result);
    });
    // GET SINGLE BOOK---->
    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const query = { _id: new ObjectId(id) };
        const result = await bookCollection.findOne(query);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(400).send({ message: "Invalid ID" });
      }
    });
    // POST THE BOOK---->
    app.post("/books", async (req, res) => {
      const product = req.body;
      // console.log("product",product)
      const result = await bookCollection.insertOne(product);
      res.send(result);
    });
    // GET ALL BOOKS---->
    app.get("/all-books", async (req, res) => {
      const { page = 1, limit = 8, search = "", sort = "newest" } = req.query;

      const query = {
        $or: [
          { title: { $regex: search, $options: "i" } },
          { author: { $regex: search, $options: "i" } },
        ],
      };
      // SORTING
      let sortOption = {};
      if (sort === "newest") sortOption = { _id: -1 };
      else if (sort === "oldest") sortOption = { _id: 1 };
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const books = await bookCollection
        .find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort(sortOption)
        .toArray();
      const total = await bookCollection.countDocuments(query);
      res.send({ books, total });
    });
    // TODO : _______________ ORDER ROUTES ______________________
    // ORDER POST--------->
    app.post("/orders", async (req, res) => {
      try {
        const order = req.body;
        if (!order.shippingInfo) {
          return res.status(400).send({ message: "Shipping info is required" });
        }
        const result = await orderCollection.insertOne(order);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server Error", error });
      }
    });
    //? ______________________user order manage by user____________
    // GET SINGLE ORDER FOR USER----->
    app.get("/user-orders", verifyToken, async (req, res) => {
      const email = req.query.email;
      console.log("decoded email", req?.user?.email);
      if (email !== req?.user?.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      try {
        const result = await orderCollection
          .find({ buyerEmail: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server Error", error });
      }
    });
    // DELETE USER ORDER----->
    app.delete("/user-orders/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await orderCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server Error", error });
      }
    });
    // USER PAYMENT HISTORY BY USER
    app.get("/user-payment-history", async (req, res) => {
      const email = req.query.email;
      console.log("email", email);
      try {
        const result = await orderCollection
          .find({ buyerEmail: email, paymentStatus: "paid" })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server Error", error });
      }
    });
    // TODO : _______________ WISHLIST ROUTES ______________________
    // WISHLIST POST--------->
    app.post("/wishlist", async (req, res) => {
      try {
        const {
          userEmail,
          bookId,
          bookTitle,
          bookImage,
          bookPrice,
          location,
          author,
        } = req.body;

        if (!userEmail || !bookId) {
          return res.status(400).send({ message: "Missing data" });
        }

        const exists = await wishlistCollection.findOne({ userEmail, bookId });

        if (exists) {
          return res.send({ message: "Already in wishlist" });
        }

        const result = await wishlistCollection.insertOne({
          userEmail,
          bookId,
          bookTitle,
          bookImage,
          bookPrice,
          location,
          author,
          createdAt: new Date(),
        });

        res.send(result);
      } catch (error) {
        // duplicate error handle (index er jonno)
        if (error.code === 11000) {
          return res.send({ message: "Already added" });
        }
        res.status(500).send({ error: error.message });
      }
    });
    // WISHLIST GET--------->
    app.get("/wishlist/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const result = await wishlistCollection
          .find({ userEmail: email })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    // WISHLIST DELETE--------->
    app.delete("/wishlist", async (req, res) => {
      try {
        const { userEmail, bookId } = req.body;
        const result = await wishlistCollection.deleteOne({
          userEmail,
          bookId,
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server Error", error });
      }
    });
    // RECENTLY VIEWED BOOK
    app.post("/recently-viewed", async (req, res) => {});

    //TODO :_________________ STRIPE PAYMENT______________________
    // CREATE CHECKOUT SESSION----->
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const order = req.body;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",

          line_items: [
            {
              price_data: {
                currency: "bdt",
                product_data: {
                  name: order.bookTitle,
                },
                unit_amount: order.total * 100,
              },
              quantity: 1,
            },
          ],

          // 🔥 IMPORTANT
          metadata: {
            orderData: JSON.stringify(order),
          },

          success_url: `http://localhost:5173/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: "http://localhost:5173/cancel",
        });

        res.send({ url: session.url });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    // GET CHECKOUT SESSION-------->
    app.get("/checkout-session/:id", async (req, res) => {
      try {
        const session = await stripe.checkout.sessions.retrieve(req.params.id);
        const orderData = JSON.parse(session.metadata.orderData);
        res.send(orderData);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ! _____________________ping database ________________________
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hello world");
});
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
