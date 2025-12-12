# CHRONOMUSIOUN

A full-stack museum website featuring timekeeping artifacts.

## Features
- Navbar with logo, Home, Favourite, About, Gallery, Download, Search, Login
- Hero section with side scrollable image area
- Gallery grid with details, favourite toggle, and download
- Search across title/description/year
- Simple login (mock) with cookie; favorites sync to server
- Footer

## Tech
- Backend: Node.js, Express
- Frontend: Vanilla HTML/CSS/JS

## Setup
```bash
npm install
npm run start
```
Open `http://localhost:3000`.

## Notes
- Images use Unsplash sample URLs.
- Downloads are proxied via `/download/:id` to add attachment headers.
- Favorites persist locally in `localStorage` and sync to server when logged in.


![homepage](./assets/homepage.png)
![herosection](./assets/herosection.png.png)
![gallery section of homepage](./assets/gallery%20section%20of%20homepage.png)
![body section of homepage and backtotop button](./assets/body%20section%20of%20homepage%20and%20backtotop%20button.png)
![footer](./assets/footer.png)
![about](./assets/about.png)
![download file popup](./assets/download%20file%20popup.png)
![avourite & download button](./assets/favourite%20&%20download%20button.png)
![favourite%20tab](./assets/favourite%20tab.png)
![Login](./assets/login.png)
![signup](./assets/signup.png)



