using UnityEngine;
using System.Collections;
using System.Collections.Generic;
using UnityEngine.UI;
using TMPro;

public class ARStoryGameManager : MonoBehaviour
{
    [System.Serializable]
    public class Card
    {
        public string objectName;
        public Texture cardImage;

        [Header("Aia")]
        public GameObject correto;
        public GameObject incorreto;
    }

    [Header("Cartas (20)")]
    [SerializeField] private List<Card> allCards;

    [Header("UI")]
    [SerializeField] private RawImage missionImage;
    [SerializeField] private TMP_Text scoreText;
    [SerializeField] private TMP_Text timerText;

    [Header("Pontuação")]
    [SerializeField] private int fastPoints = 100;
    [SerializeField] private int mediumPoints = 70;
    [SerializeField] private int slowPoints = 40;
    [SerializeField] private int verySlowPoints = 10;

    [Header("Áudio")]
    [SerializeField] private AudioSource audioSource;
    [SerializeField] private AudioClip correctSound;
    [SerializeField] private AudioClip errorSound;

    [Header("Tempo entre missões")]
    [SerializeField] private float delayNextMission = 2f;

    [Header("Tempo embaralhar")]
    [SerializeField] private float shuffleTime = 2f;

    private Card currentCard;
    private List<Card> deck = new List<Card>();

    private Dictionary<string, GameObject> cardObjects = new Dictionary<string, GameObject>();

    private float startTime;
    private int score;

    private bool waitingNextMission = false;
    private float lastErrorTime = 0;

    void Start()
    {
        score = PlayerPrefs.GetInt("score", 0);
        UpdateScoreUI();

        ResetDeck();

        foreach (var card in allCards)
        {
            GameObject obj = GameObject.Find(card.objectName);

            if (obj != null && !cardObjects.ContainsKey(card.objectName))
                cardObjects.Add(card.objectName, obj);
        }
    }

    public void Iniciar()
    {
        StartCoroutine(ShuffleAndGenerate());
    }
    void Update()
    {
        if (waitingNextMission) return;

        CheckActiveCards();
        UpdateTimerUI();
    }

    // =========================
    // EMBARALHAR
    // =========================

    IEnumerator ShuffleAndGenerate()
    {
        waitingNextMission = true;

        float elapsed = 0;
        float interval = 0.05f;

        while (elapsed < shuffleTime)
        {
            int randomIndex = Random.Range(0, allCards.Count);

            missionImage.texture = allCards[randomIndex].cardImage;

            yield return new WaitForSeconds(interval);

            elapsed += interval;

            interval += 0.01f;
        }

        GenerateNewMission();

        waitingNextMission = false;
    }

    // =========================
    // NOVA MISSÃO
    // =========================

    void GenerateNewMission()
    {
        if (deck.Count == 0)
        {
            ResetDeck();
        }

        currentCard = deck[0];
        deck.RemoveAt(0);

        missionImage.texture = currentCard.cardImage;

        startTime = Time.time;

        UpdateAiaStates();

        Debug.Log("Nova carta sorteada: " + currentCard.objectName);
    }

    // =========================
    // CONTROLE DA AIA
    // =========================

    void UpdateAiaStates()
    {
        foreach (var card in allCards)
        {
            if (card.correto != null)
                card.correto.SetActive(false);

            if (card.incorreto != null)
                card.incorreto.SetActive(true);
        }

        if (currentCard != null)
        {
            if (currentCard.correto != null)
                currentCard.correto.SetActive(true);

            if (currentCard.incorreto != null)
                currentCard.incorreto.SetActive(false);
        }
    }

    // =========================
    // SCAN
    // =========================

    void CheckActiveCards()
    {
        foreach (var card in allCards)
        {
            GameObject obj;

            if (!cardObjects.TryGetValue(card.objectName, out obj))
            {
                obj = GameObject.Find(card.objectName);

                if (obj != null)
                    cardObjects[card.objectName] = obj;
            }

            if (obj != null && obj.activeInHierarchy)
            {
                Debug.Log("Carta detectada: " + card.objectName);

                if (card.objectName == currentCard.objectName)
                {
                    CorrectScan();
                }
                else
                {
                    WrongScan(card.objectName);
                }

                break;
            }
        }
    }

    // =========================
    // ACERTO
    // =========================

    void CorrectScan()
    {
        if (waitingNextMission) return;

        waitingNextMission = true;

        audioSource.PlayOneShot(correctSound);

        float timeTaken = Time.time - startTime;

        int points = CalculatePoints(timeTaken);

        score += points;

        PlayerPrefs.SetInt("score", score);

        UpdateScoreUI();

        Debug.Log("ACERTO ✔  Carta correta: " + currentCard.objectName + " | Pontos: " + points);

        StartCoroutine(NextMissionDelay());
    }

    // =========================
    // ERRO
    // =========================

    void WrongScan(string detectedCard)
    {
        if (Time.time - lastErrorTime < 1f) return;

        audioSource.PlayOneShot(errorSound);

        Debug.LogWarning(
            "ERRO DE SCAN\n" +
            "A carta esperada era: " + currentCard.objectName +
            "\nFoi escaneada: " + detectedCard
        );

        lastErrorTime = Time.time;
    }

    // =========================
    // PROXIMA MISSÃO
    // =========================

    IEnumerator NextMissionDelay()
    {
        yield return new WaitForSeconds(delayNextMission);

        StartCoroutine(ShuffleAndGenerate());
    }

    // =========================
    // BOTÃO PULAR
    // =========================

    public void SkipMission()
    {
        if (!waitingNextMission)
            StartCoroutine(NextMissionDelay());
    }

    // =========================
    // UI
    // =========================

    void UpdateScoreUI()
    {
        scoreText.text = "Pontos: " + score;
    }

    void UpdateTimerUI()
    {
        float elapsed = Time.time - startTime;
        timerText.text = "Tempo: " + elapsed.ToString("F1") + "s";
    }

    // =========================
    // PONTUAÇÃO
    // =========================

    int CalculatePoints(float time)
    {
        if (time <= 3f) return fastPoints;
        if (time <= 6f) return mediumPoints;
        if (time <= 10f) return slowPoints;
        return verySlowPoints;
    }

    // =========================
    // DECK
    // =========================

    void ResetDeck()
    {
        deck = new List<Card>(allCards);

        for (int i = 0; i < deck.Count; i++)
        {
            Card temp = deck[i];
            int randomIndex = Random.Range(i, deck.Count);

            deck[i] = deck[randomIndex];
            deck[randomIndex] = temp;
        }
    }
}