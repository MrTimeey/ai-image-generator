function onSubmit(e) {
    e.preventDefault();

    let msgElement = document.createElement('h2');
    msgElement.classList.add('msg');

    document.getElementsByClassName('image-container')[0].replaceChildren();
    document.getElementsByClassName('image-container')[0].appendChild(msgElement);

    const baseImagePath = document.querySelector('#baseImage').value;
    const baseImage = document.querySelector('#hiddenBaseImage');
    const size = document.querySelector('#size').value;
    const amount = document.querySelector('#amount').value;

    if (baseImagePath === '') {
        alert('Please choose an image');
        return;
    }
    console.log('TOM', baseImagePath, baseImage);

    generateImageAlternatives(baseImage.src, size, amount);
}

async function generateImageAlternatives(image, size, amount) {
    try {
        showSpinner();

        const response = await fetch('/api/openai/generate-alternative-images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                baseImage: image,
                amount: parseInt(amount),
                size: size.toUpperCase(),
            }),
        });

        if (!response.ok) {
            removeSpinner();
            throw new Error('The alternative could not be generated');
        }

        const data = await response.json();

        let imagesContainer = document.getElementsByClassName('image-container')[0];
        data.urls.forEach((imageUrl) => {
            let imageElement = document.createElement('img');
            imageElement.src = imageUrl.url;
            imagesContainer.appendChild(imageElement);
        });
    } catch (error) {
        document.querySelector('.msg').textContent = error;
    } finally {
        removeSpinner();
    }
}

function showSpinner() {
    document.querySelector('.spinner').classList.add('show');
}

function removeSpinner() {
    document.querySelector('.spinner').classList.remove('show');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function readURL(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();

        reader.onload = function (e) {
            document.querySelector('#hiddenBaseImage').src = e.target.result;
        };

        reader.readAsDataURL(input.files[0]);
    }
}

document.querySelector('#image-form').addEventListener('submit', onSubmit);
